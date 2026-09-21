import type { SupabaseClient } from "@supabase/supabase-js";
import { PANEL_UPLOAD_BUCKET } from "@/lib/content/assetUsability";
import { resolveWbCardCoverUrl } from "@/lib/wb/cardImage";

/**
 * Закрепление картинок CTR-теста: копия в нашем хранилище вместо ссылки.
 *
 * Ссылка `basket-NN.wbbasket.ru/…/images/big/1.webp` — это адрес ПОЗИЦИИ в
 * карточке, а не файла. Пока в карточке стоит одно фото, она отдаёт его; после
 * того как автосмена положила туда вариант B, тот же адрес отдаёт B. Вариант
 * теста, записанный такой ссылкой, «возвращается» на витрину тем, что там уже
 * висит: раунд отмечается, показы приписываются варианту, а картинка не
 * меняется. На тесте 13 так «Текущее фото» ни разу не вернулось после первого
 * раунда, а после завершения на карточке остался последний вариант.
 *
 * Поэтому всё, что тест кладёт на витрину, — и варианты, и исходная обложка, —
 * сначала копируется в наш публичный бакет и живёт там как обычный файл.
 */

/** Префикс закреплённых копий внутри публичного бакета `factory-media`. */
export const CTR_PIN_PREFIX = "ctr-pinned";
const MAX_PIN_BYTES = 12 * 1024 * 1024;
const PUBLIC_STORAGE_MARK = "supabase.co/storage/v1/object/public/";

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Настоящий тип файла по его байтам, а не по заголовку ответа: адрес может
 * отдать страницу с ошибкой под видом картинки.
 */
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((byte, index) => bytes[index] === byte)) return "image/png";
  const riff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  const webp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (bytes.length >= 12 && riff && webp) return "image/webp";
  return null;
}

/** Ссылка на живую картинку карточки WB: содержимое по ней меняется вместе с карточкой. */
export function isLiveWbCoverUrl(url: string | null | undefined): boolean {
  return /^https:\/\/([a-z0-9-]+\.)*(wbbasket\.ru|wbstatic\.net|wbcontent\.net)\//i.test(String(url ?? "").trim());
}

/** Лежит ли файл в нашем публичном хранилище — там он не меняется. */
export function isPinnedStorageUrl(url: string | null | undefined): boolean {
  return String(url ?? "").includes(PUBLIC_STORAGE_MARK);
}

/** Нужна ли копия: всё, что не лежит у нас, может измениться или пропасть. */
export function needsPin(url: string | null | undefined): boolean {
  const value = String(url ?? "").trim();
  return value.startsWith("https://") && !isPinnedStorageUrl(value);
}

export type PinResult = { ok: true; url: string; path: string } | { ok: false; error: string };

/** Публичный контракт хранилища: ровно то, чем пользуется закрепление. */
export type PinDb = Pick<SupabaseClient, "storage">;

/**
 * Скачивает картинку и кладёт копию в наш бакет.
 *
 * Отказ — это отказ, а не «положили что получилось»: тест с вариантом, которого
 * у нас нет, нельзя запускать, потому что автосмена скачает его в момент записи
 * в карточку, и если адрес к тому времени умер, раунд не сменит фото.
 */
export async function pinImageFromUrl(
  db: PinDb,
  input: { url: string; cabinetId: string; nmId: number },
): Promise<PinResult> {
  let bytes: Uint8Array;
  try {
    const response = await fetch(input.url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return { ok: false, error: `картинка не открылась: HTTP ${response.status}` };
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_PIN_BYTES) return { ok: false, error: `файл больше ${MAX_PIN_BYTES / 1024 / 1024} МБ` };
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (cause) {
    return { ok: false, error: `картинку не скачать: ${cause instanceof Error ? cause.message : "ошибка сети"}` };
  }
  if (bytes.length === 0) return { ok: false, error: "по адресу пусто" };
  if (bytes.length > MAX_PIN_BYTES) return { ok: false, error: `файл больше ${MAX_PIN_BYTES / 1024 / 1024} МБ` };

  const mime = sniffImageMime(bytes);
  if (!mime) return { ok: false, error: "по адресу не картинка: годятся JPEG, PNG и WebP" };

  const path = `${CTR_PIN_PREFIX}/${input.cabinetId}/${input.nmId}/${crypto.randomUUID()}.${EXTENSION_BY_MIME[mime]}`;
  const upload = await db.storage.from(PANEL_UPLOAD_BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
  if (upload.error) return { ok: false, error: `хранилище не приняло файл: ${upload.error.message}` };

  const publicUrl = db.storage.from(PANEL_UPLOAD_BUCKET).getPublicUrl(path).data?.publicUrl ?? "";
  if (!publicUrl) {
    await db.storage.from(PANEL_UPLOAD_BUCKET).remove([path]);
    return { ok: false, error: "хранилище не вернуло публичную ссылку" };
  }
  return { ok: true, url: publicUrl, path };
}

/** Убрать закреплённые копии, оставшиеся от неудавшегося создания. */
export async function removePinned(db: PinDb, paths: string[]): Promise<void> {
  if (!paths.length) return;
  await db.storage.from(PANEL_UPLOAD_BUCKET).remove(paths).then(() => undefined, () => undefined);
}

/**
 * Живая обложка карточки, из которой снимаем копию.
 *
 * Сначала `hq`, и это не прихоть: копия потом уходит обратно в карточку как
 * новая обложка, и `big` (900×1200) навсегда срезал бы её разрешение против
 * исходного. Но `hq` на CDN нередко отсутствует — тогда берём `big`: копия
 * с меньшим разрешением лучше, чем никакой.
 */
export async function resolveLiveCoverSource(nmId: number): Promise<string | null> {
  const hq = await resolveWbCardCoverUrl(nmId, "https://basket-00.wbbasket.ru/x/images/hq/1.webp");
  if (hq) return hq;
  return resolveWbCardCoverUrl(nmId, "https://basket-00.wbbasket.ru/x/images/big/1.webp");
}
