// Карточки товаров кабинета(ов) через WB Content API: article + nm_id + name + цвет + ниша(subject).
import { getActiveWbCabinets, getWbCabinetSources } from "@/lib/wb/cabinetTokens";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { wbPhotoBig, wbPhotoThumb } from "@/lib/wb/photoUrl";
import { allowsProduct } from "@/lib/wb/productScope";
import type { ProductReadinessStatus } from "@/lib/wb/productReadiness";
import { loadHourlyDashboard, type HourlyDashboardCacheOptions } from "@/lib/cache/hourlyDashboard";
import { fetchWbCardPages, fetchWbCardsByNmIds } from "@/lib/wb/cardPagination";

const CARDS_URL = "https://content-api.wildberries.ru/content/v2/get/cards/list";

interface Characteristic { name?: string; value?: string | string[] }
interface RawDimensions { length?: number; width?: number; height?: number; weightBrutto?: number }
// WB отдаёт шесть размеров одного фото. Какой из них брать — не вопрос вкуса:
// у hq на CDN чаще всего нет файла, см. lib/wb/photoUrl.ts.
// Историческая заметка ниже оставлена, чтобы выбор не откатили обратно.
// WB отдаёт шесть размеров одного фото. hq (1800×2400) вдвое больше big
// (900×1200) — и именно hq обязан уходить в запись и в генерацию: media/save
// заменяет набор целиком, а оригинала у WB нет вовсе.
interface RawPhoto { hq?: string; big?: string; c516x688?: string; c246x328?: string }
interface RawCard {
  nmID: number; imtID?: number; vendorCode: string; title?: string; subjectName?: string; brand?: string;
  characteristics?: Characteristic[]; dimensions?: RawDimensions; photos?: RawPhoto[];
  // Точное поле WB под видео не подтверждено документацией (сайт блокирует прямой
  // fetch спецификации) — проверяем оба правдоподобных места best-effort. См.
  // hasVideoOn() ниже и lib/wb/media.ts за причиной, почему это важно.
  video?: unknown;
  media?: { video?: unknown };
}

function hasVideoOn(c: RawCard): boolean {
  return c.video != null || c.media?.video != null;
}

export interface CabinetCard { article: string; nm_id: number; name: string; color: string; subject: string; shop: string }

export interface PimRow {
  nmId: number; imtId: number; article: string; name: string; brand: string; subject: string; shop: string;
  cabinetId: string | null;
  length: number | null; width: number | null; height: number | null; weightBrutto: number | null;
  materials: string; photosCount: number;
  /** Миниатюры 246×328 — ТОЛЬКО для сетки превью, никогда для записи и генерации. */
  photos: string[];
  /** Те же фото в максимальном размере, который отдаёт WB. */
  photosBig: string[];
  hasVideo: boolean; wbUrl: string;
  readinessStatus?: ProductReadinessStatus;
  comment?: string;
  driveUrl?: string | null;
  noteUpdatedBy?: string | null;
  noteUpdatedAt?: string | null;
}

const characteristicOf = (c: RawCard, re: RegExp): string => {
  const ch = (c.characteristics || []).find((x) => re.test(x.name || ""));
  if (!ch) return "";
  return Array.isArray(ch.value) ? ch.value.join(", ") : String(ch.value || "");
};

function colorOf(c: RawCard): string {
  return characteristicOf(c, /цвет/i);
}

async function fetchSourceCatalog(src: Awaited<ReturnType<typeof getWbCabinetSources>>[number]): Promise<RawCard[]> {
  if (src.productScope.allowedNmIds !== null) {
    return fetchWbCardsByNmIds<RawCard>({
      token: src.token,
      nmIds: src.productScope.allowedNmIds,
    });
  }
  const catalog = await fetchWbCardPages<RawCard>({ token: src.token });
  if (!catalog.caughtUp) throw new Error("каталог не догружен до конца курсора");
  return catalog.rows;
}

// cabinetId задан → один кабинет; null → все активные.
export async function fetchCabinetCards(cabinetId: string | null): Promise<CabinetCard[]> {
  const sources = await getWbCabinetSources(cabinetId, "content");
  const out: CabinetCard[] = [];
  const failures: string[] = [];
  for (const src of sources) {
    try {
      const catalog = await fetchSourceCatalog(src);
      for (const c of catalog) {
        if (!allowsProduct(src.productScope, c.nmID, c.brand)) continue;
        out.push({ article: c.vendorCode || String(c.nmID), nm_id: c.nmID, name: c.title || "", color: colorOf(c), subject: c.subjectName || "", shop: src.name });
      }
    } catch (error) {
      failures.push(`${src.name}: ${error instanceof Error ? error.message : "не удалось загрузить карточки"}`);
    }
  }
  if (failures.length) throw new Error(`Карточки WB загружены не полностью: ${failures.join("; ")}`);
  return out;
}

// PIM-лайт: размеры/материалы/фото-комплектность по SKU — тот же Content API,
// без МойСклад (себестоимость и остаток уже есть отдельно в Себестоимости/Остатках).
export async function fetchCabinetPimRows(cabinetId: string | null): Promise<PimRow[]> {
  const sources = await getWbCabinetSources(cabinetId, "content");
  const results = await Promise.all(sources.map(async (src) => {
    const rows: PimRow[] = [];
    try {
      const catalog = await fetchSourceCatalog(src);
      for (const c of catalog) {
        if (!allowsProduct(src.productScope, c.nmID, c.brand)) continue;
        // Два массива, а не один: миниатюры для сетки превью и большие версии
        // для всего, что уходит наружу — генерации и записи на карточку.
        const photos = (c.photos || []).map(wbPhotoThumb).filter(Boolean);
        const photosBig = (c.photos || []).map(wbPhotoBig).filter(Boolean);
        rows.push({
          nmId: c.nmID,
          imtId: Number.isFinite(c.imtID) ? Number(c.imtID) : c.nmID,
          article: c.vendorCode || String(c.nmID),
          name: c.title || "",
          brand: c.brand || "",
          subject: c.subjectName || "",
          shop: src.name,
          cabinetId: src.id,
          length: c.dimensions?.length ?? null,
          width: c.dimensions?.width ?? null,
          height: c.dimensions?.height ?? null,
          weightBrutto: c.dimensions?.weightBrutto ?? null,
          materials: characteristicOf(c, /материал|состав/i),
          photosCount: photos.length,
          photos,
          photosBig,
          hasVideo: hasVideoOn(c),
          wbUrl: `https://www.wildberries.ru/catalog/${c.nmID}/detail.aspx`,
        });
      }
      return { ok: true as const, rows, error: null };
    } catch (error) {
      return { ok: false as const, rows: [], error: `${src.name}: ${error instanceof Error ? error.message : "не удалось загрузить карточки"}` };
    }
  }));
  const failures = results.filter((result) => !result.ok).map((result) => result.error);
  if (failures.length) throw new Error(`Карточки WB загружены не полностью: ${failures.join("; ")}`);
  const rows = results.flatMap((result) => result.rows);
  // Складываем в базу: кэш Next живёт внутри своего бандла, и снимок, записанный
  // одним роутом, другой не находит. Базу видят все — оттуда фильтры РНП берут
  // бренд и предмет, даже когда снимок холодный.
  void persistCards(rows);
  return rows;
}

/** Обновление справочника карточек. Ошибка записи не должна ронять обход. */
async function persistCards(rows: PimRow[]): Promise<void> {
  if (!rows.length) return;
  const db = getSupabaseAdmin();
  if (!db) return;
  const payload = rows.map((row) => ({
    cabinet_id: row.cabinetId ?? null,
    nm_id: row.nmId,
    imt_id: row.imtId ?? null,
    article: row.article || null,
    name: row.name || null,
    brand: row.brand || null,
    subject: row.subject || null,
    shop: row.shop || null,
    // Галерея карточки. Обход её уже собрал строкой выше — не записывать её
    // значило считать заново при каждом вопросе «какие фото есть у товара».
    // Пустой массив от отсутствия галереи отличаем null'ом: у карточки без
    // фото список пуст, а у карточки, обойдённой до этой правки, его нет.
    photos: row.photos ?? null,
    photos_big: row.photosBig ?? null,
    photos_count: row.photosCount ?? null,
    has_video: row.hasVideo ?? null,
    updated_at: new Date().toISOString(),
  }));
  for (let index = 0; index < payload.length; index += 500) {
    const { error } = await db
      .from("wb_cards")
      .upsert(payload.slice(index, index + 500), { onConflict: "cabinet_id,nm_id" });
    if (error) return; // таблицы ещё нет или запись недоступна — не мешаем обходу
  }
}

/**
 * Справочник карточек из базы: бренд и предмет для экранов, которым нельзя
 * ждать обход Content API (на крупном кабинете он идёт больше минуты).
 */
export async function loadCardsFromDb(cabinetId: string | null): Promise<PimCardRef[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const query = db.from("wb_cards").select("nm_id, article, name, brand, subject");
  const { data, error } = await (cabinetId ? query.eq("cabinet_id", cabinetId) : query);
  if (error || !data) return [];
  return data.map((row) => ({
    nmId: Number(row.nm_id),
    article: String(row.article ?? ""),
    name: String(row.name ?? ""),
    brand: String(row.brand ?? ""),
    subject: String(row.subject ?? ""),
  }));
}

/** Минимум, который нужен экранам от карточки. */
export interface PimCardRef {
  nmId: number;
  article: string;
  name: string;
  brand: string;
  subject: string;
}

// Все тяжёлые GET-экраны используют один и тот же часовой снимок карточек.
// Это убирает повторный обход Content API при открытии PIM, поставок и других
// модулей, а параллельный fetch выше ограничивает холодный старт самым медленным
// кабинетом вместо суммы времени по всем кабинетам.
/**
 * Снимка карточек в кэше нет. Бросаем, а не возвращаем пустоту: пустой список
 * попал бы в кэш на час и обесточил бы названия там, где они есть.
 */
export class PimSnapshotColdError extends Error {
  constructor() {
    super("Снимок карточек WB ещё не прогрет");
    this.name = "PimSnapshotColdError";
  }
}

export function loadCabinetPimRowsHourly(
  cabinetId: string | null,
  options: HourlyDashboardCacheOptions & { cacheOnly?: boolean } = {},
): Promise<PimRow[]> {
  // Холодный обход Content API занимает до минуты на крупном кабинете и не
  // укладывается в лимит пользовательской функции — экран отдавал 504 целиком.
  // Пользовательский путь читает только готовый снимок (cacheOnly); греет его
  // cron, где лимит времени в пять раз больше.
  //
  // Колбэк ОДИН на оба режима. unstable_cache подмешивает в ключ саму
  // функцию, поэтому отдельная ветка «только из кэша» со своим колбэком
  // читала снимок под другим ключом — и всегда получала холод, сколько бы
  // раз его ни грели. Отсюда пустые «Бренд» и «Категория» в РНП: карточек
  // не было ни разу, хотя /api/pim отдавал их за пару секунд.
  const { cacheOnly, ...cacheOptions } = options;
  return loadHourlyDashboard(
    "wb-pim-cards",
    { cabinetId, schema: 4 },
    async () => {
      if (cacheOnly) throw new PimSnapshotColdError();
      // Общий снимок компонуется из кабинетных. Так один холодный обход
      // одновременно прогревает PIM, поставки и «Склейки» для каждого кабинета.
      if (cabinetId === null) {
        const cabinets = await getActiveWbCabinets();
        if (cabinets.length) {
          // Виртуальные кабинеты могут принадлежать одному продавцу и делить
          // лимит Content API. Последовательный прогрев не создаёт «стадо»
          // одновременных 429 и всё равно укладывается в 300-секундный cron.
          const rows: PimRow[] = [];
          for (const cabinet of cabinets) {
            rows.push(...await loadCabinetPimRowsHourly(cabinet.id, cacheOptions));
          }
          return rows;
        }
      }
      return fetchCabinetPimRows(cabinetId);
    },
    cacheOptions,
  );
}

// Свежая (не из кэша страницы) проверка конкретной карточки перед записью
// в media/save — WB документирует, что data[] ПОЛНОСТЬЮ заменяет прежний
// набор медиафайлов карточки; видео грузится отдельным методом
// (content/v3/media/file), но не подтверждено, живёт ли оно в том же
// наборе, что перетирает media/save. Пока не проверено эмпирически —
// не рискуем и блокируем запись, если видео обнаружено (см. app/api/cover-test).
export async function checkCardHasVideo(token: string, nmId: number): Promise<boolean> {
  const card = await fetchCardForWrite(token, nmId);
  return card.hasVideo;
}

export interface CardForWrite {
  /** WB подтвердил карточку. false — писать нельзя ни при каких условиях. */
  found: boolean;
  hasVideo: boolean;
  /**
   * Фотографии карточки в САМОМ БОЛЬШОМ размере, который отдаёт WB (hq,
   * 1800×2400), и в том порядке, в каком они сейчас стоят.
   *
   * Это не то же, что PimRow.photos: там лежат витринные миниатюры 246×328 —
   * они годятся для сетки превью и катастрофичны для записи. media/save
   * заменяет набор медиафайлов ЦЕЛИКОМ, поэтому отправить туда миниатюры
   * значит подменить всю галерею почтовыми марками, а оригиналы у WB не
   * восстановить. Массив для показа и массив для записи обязаны быть разными
   * объектами, и второй берётся только здесь, свежим запросом к WB.
   */
  photos: string[];
}

/** Свежая карточка WB для записи: сама решает, можно ли писать и что писать. */
export async function fetchCardForWrite(token: string, nmId: number): Promise<CardForWrite> {
  const blocked: CardForWrite = { found: false, hasVideo: true, photos: [] };
  let cursor: { updatedAt?: string; nmID?: number } = {};
  for (let page = 0; page < 1_000; page++) {
    const res = await fetch(CARDS_URL, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { cursor: { limit: 100, ...cursor }, filter: { withPhoto: -1 } } }),
      cache: "no-store",
    });
    if (!res.ok) return blocked; // не смогли проверить — считаем небезопасным
    const json = (await res.json()) as { cards?: RawCard[]; cursor?: { updatedAt?: string; nmID?: number } };
    const batch = json.cards ?? [];
    const found = batch.find((c) => c.nmID === nmId);
    if (found) {
      return {
        found: true,
        hasVideo: hasVideoOn(found),
        // ЗДЕСЬ hq ОБЯЗАТЕЛЕН, в отличие от читающего пути выше.
        // Этот массив уходит в media/save, а он заменяет набор медиа целиком и
        // необратимо: записать big (900×1200) значило бы навсегда срезать
        // галерею вдвое. То, что hq на CDN часто отсутствует, здесь работает
        // предохранителем — WB не заберёт мёртвый адрес и запись не состоится.
        // Отказ дороже неудобства, потому что откатить его нечем.
        photos: (found.photos ?? []).map((p) => p.hq || p.big || "").filter(Boolean),
      };
    }
    if (batch.length < 100) return blocked; // карточку не нашли — не рискуем
    cursor = { updatedAt: json.cursor?.updatedAt, nmID: json.cursor?.nmID };
  }
  return blocked;
}

