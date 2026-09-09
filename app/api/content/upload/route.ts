import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { isPanelOwned, isPanelUpload, PANEL_UPLOAD_BUCKET, PANEL_UPLOAD_PREFIX } from "@/lib/content/assetUsability";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Своё фото в библиотеку контента — и обратно из неё.
 *
 * До сих пор в тест можно было отдать только то, что уже лежало в карточке WB
 * или приехало от контент-завода. Снятый вчера кадр попадал в панель никак:
 * человек шёл выкладывать его куда-то наружу ради публичной ссылки, потому что
 * вариант теста скачивает сам WB и относительный путь ему не годится.
 *
 * Кладём в публичный бакет `factory-media` под отдельный префикс — оттуда
 * ссылка сразу «публичная» по правилам lib/content/assetUsability, то есть
 * годится в тест без дополнительных действий. Префикс отдельный намеренно: по
 * нему же отличается «наша загрузка» от съёмок завода, а значит видно, что
 * можно удалить.
 */
const BUCKET = PANEL_UPLOAD_BUCKET;
const PREFIX = PANEL_UPLOAD_PREFIX;
const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/** Путь внутри бакета: по нему видно кабинет, товар и что это наша загрузка. */
function objectPath(cabinetId: string, nmId: number, extension: string): string {
  return `${PREFIX}/${cabinetId}/${nmId}/${crypto.randomUUID()}.${extension}`;
}

export async function POST(request: NextRequest) {
  const gate = await requireApiSession(["director", "fin_director", "financier", "wb_manager", "ozon_manager", "seller"]);
  if (gate) return gate;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const cabinetId = String(form?.get("cabinet") ?? "").trim();
  const nmId = Number(form?.get("nmId"));
  const article = String(form?.get("article") ?? "").trim();

  if (!(file instanceof File)) return fail("Файл не приложен", 400);
  if (!cabinetId || !Number.isInteger(nmId) || nmId <= 0) return fail("Не указан товар", 400);
  if (!(await hasCabinetAccess(cabinetId))) return fail("Нет доступа к кабинету", 403);

  const extension = ALLOWED.get(file.type);
  if (!extension) return fail("Годятся JPEG, PNG и WebP — WB другие форматы не примет", 415);
  if (file.size > MAX_BYTES) {
    return fail(`Файл ${(file.size / 1024 / 1024).toFixed(1)} МБ, а можно до ${MAX_BYTES / 1024 / 1024} МБ`, 413);
  }

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const path = objectPath(cabinetId, nmId, extension);
  const upload = await db.storage.from(BUCKET).upload(path, new Uint8Array(await file.arrayBuffer()), {
    contentType: file.type,
    upsert: false,
  });
  if (upload.error) return fail(`Хранилище не приняло файл: ${upload.error.message}`, 502);

  const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path);
  const url = pub?.publicUrl ?? "";
  if (!url) {
    await db.storage.from(BUCKET).remove([path]);
    return fail("Хранилище не вернуло публичную ссылку", 502);
  }

  // Запись в каталог — то, что делает файл видимым в библиотеке. Если она не
  // прошла, файл в хранилище лишний: убираем, иначе он останется висеть
  // невидимым мусором, за который никто не отвечает.
  const insert = await db.from("content_assets").insert({
    article: article || null,
    kind: "image",
    url,
    name: file.name,
    disk: "panel",
    path,
  }).select("id").single();
  if (insert.error) {
    await db.storage.from(BUCKET).remove([path]);
    return fail(`Каталог не принял запись: ${insert.error.message}`, 502);
  }

  // id возвращаем, чтобы экран показал плитку сразу и с тем же ключом, каким её
  // потом соберёт обход каталога: библиотека отдаёт 2,6 МБ за восемь секунд, и
  // ждать их ради одной картинки значит делать вид, что кнопка не сработала.
  return NextResponse.json({ id: insert.data?.id ?? null, url, name: file.name });
}

/** Убрать свою загрузку — из каталога и из хранилища. */
export async function DELETE(request: NextRequest) {
  const gate = await requireApiSession(["director", "fin_director", "financier", "wb_manager", "ozon_manager", "seller"]);
  if (gate) return gate;

  const url = new URL(request.url);
  const target = String(url.searchParams.get("url") ?? "").trim();
  const cabinetId = String(url.searchParams.get("cabinet") ?? "").trim();
  if (!target) return fail("Не указан файл", 400);
  if (!cabinetId) return fail("Не указан кабинет", 400);
  if (!(await hasCabinetAccess(cabinetId))) return fail("Нет доступа к кабинету", 403);
  if (!isPanelOwned(target)) {
    return fail("Удалить можно только файл из нашего хранилища: кадр карточки живёт в WB и вернётся при ближайшем обходе, а запись «yandex-disk:» — это путь, а не файл", 400);
  }

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  /**
   * Принадлежность проверяется по-разному, потому что папки устроены
   * по-разному.
   *
   * Загрузки с экрана несут кабинет прямо в пути — сверяем путь.
   *
   * Всё остальное в нашем бакете (`covers/`, `shoots/`, папки завода) кабинета
   * в пути не имеет: эти файлы клали пакетом по товарам, а не из кабинета. Для
   * них вопрос «твой ли файл» — это вопрос «твой ли товар», и отвечает на него
   * карточка: артикул строки каталога должен встречаться среди карточек ЭТОГО
   * кабинета. Иначе сосед по прямой ссылке снёс бы файл чужого товара.
   *
   * Строка без артикула не проходит проверку намеренно: подтвердить владение
   * нечем, а «не смог проверить» не то же самое, что «можно».
   */
  if (isPanelUpload(target)) {
    if (!target.includes(`/${PREFIX}/${cabinetId}/`)) return fail("Файл принадлежит другому кабинету", 403);
  } else {
    const asset = await db.from("content_assets").select("article").eq("url", target).limit(1).maybeSingle();
    const article = String(asset.data?.article ?? "").trim();
    if (!article) return fail("У файла не заполнен артикул — подтвердить, что он ваш, нечем", 403);
    const card = await db.from("wb_cards").select("nm_id").eq("cabinet_id", cabinetId).eq("article", article).limit(1).maybeSingle();
    if (!card.data) return fail("Товар этого файла не заведён в выбранном кабинете", 403);
  }

  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const path = decodeURIComponent(target.slice(target.indexOf(marker) + marker.length));

  // Сначала каталог, потом хранилище: пропавшая запись делает файл невидимым,
  // а осиротевший файл в бакете безвреден. Обратный порядок оставил бы в
  // библиотеке строку с битой ссылкой.
  const removed = await db.from("content_assets").delete().eq("url", target);
  if (removed.error) return fail(`Каталог не отпустил запись: ${removed.error.message}`, 502);
  const storage = await db.storage.from(BUCKET).remove([path]);
  if (storage.error) {
    return NextResponse.json({ ok: true, note: "Из библиотеки убрано; сам файл в хранилище удалить не удалось" });
  }
  return NextResponse.json({ ok: true });
}
