import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveEntity } from "@/lib/warehouse/entityAccess";
import { noWildberriesSourceReason, wildberriesOwnCabinets } from "@/lib/warehouse/cabinetChannels";
import { warmFbsBarcodeCatalog, type FbsBarcodeEntry } from "@/lib/wb/fbsBarcodeCatalog";

export const dynamic = "force-dynamic";
// Длинный лимит нужен только прогреву каталога: обход Content API с обязательной
// паузой между страницами в пользовательский лимит не влезает.
export const maxDuration = 300;

export interface VariantImportResult {
  /** Сколько размеров заведено впервые. */
  created: number;
  /** Сколько уже существовавших размеров получили баркод или chrt. */
  updated: number;
  /** Модели, к которым размеры пришли. */
  products: number;
  /** Размеры из WB, для которых в справочнике нет товара ни по карточке, ни по артикулу. */
  skippedNoProduct: number;
  /** Товарам дописана связь с карточкой WB, найденная по артикулу. */
  linkedByArticle: number;
  /** Каталог WB отдан не полностью — часть карточек не обойдена. */
  partial: boolean;
  cabinets: { name: string; entries: number; cold: boolean }[];
}

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");
const migrationHint = "Примените миграции 202608230014 и 202608230015";

/** Размеры и баркоды приходят из карточек WB: вбивать их руками для сотен позиций
 *  бессмысленно, а ошибка в баркоде ломает и ФБС, и коды маркировки. */
export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = (await request.json().catch(() => null)) as { entityId?: string } | null;
  if (!body) return fail("Некорректное тело запроса", 400);

  const scope = await resolveEntity(body.entityId ?? null);
  if (!scope.ok) return fail(scope.error, scope.status);

  // Свои кабинеты Wildberries: у агентской схемы карточки чужие, а у Ozon
  // Content API нет вовсе — его ключ в WB отправлять нельзя и незачем.
  const cabinets = wildberriesOwnCabinets(scope.entity.cabinets);
  if (cabinets.length === 0) return fail(noWildberriesSourceReason(scope.entity.name, scope.entity.cabinets), 400);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const entries: FbsBarcodeEntry[] = [];
  const cabinetStats: VariantImportResult["cabinets"] = [];
  let partial = false;

  // Карточки читаются своим обходом, а не из снимка соседнего экрана: кэш Next
  // живёт внутри роута и другому невидим — надежда на чужой прогрев означала бы
  // вечное «каталог ещё не прочитан». Обход укладывается в maxDuration.
  for (const link of cabinets) {
    try {
      const catalog = await warmFbsBarcodeCatalog(link.cabinetId);
      entries.push(...catalog.entries);
      if (!catalog.complete) partial = true;
      cabinetStats.push({ name: link.cabinetName, entries: catalog.entries.length, cold: false });
    } catch (error) {
      // Один недоступный кабинет не отменяет импорт из остальных: помечаем и идём дальше.
      cabinetStats.push({ name: link.cabinetName, entries: 0, cold: true });
      void error;
    }
  }

  if (entries.length === 0) {
    const failed = cabinetStats.filter((row) => row.cold).map((row) => row.name);
    return fail(
      failed.length > 0
        ? `Не удалось прочитать карточки: ${failed.join(", ")}. Попробуйте ещё раз — обход WB иногда обрывается.`
        : "В карточках WB не нашлось ни одного размера",
      502,
    );
  }

  // Товар ищется сначала по карточке, потом по артикулу. Одного nmID мало:
  // товар мог быть заведён из другого кабинета или вовсе без карточки, а артикул
  // у нас и в WB (vendorCode) один и тот же — это он и связывает.
  const productsResult = await db.from("products").select("id, nm_id, article");
  if (productsResult.error) {
    const code = productsResult.error.code;
    return fail(missingMigration(code) ? migrationHint : productsResult.error.message, missingMigration(code) ? 503 : 500);
  }
  const productByNm = new Map<number, string>();
  const productByArticle = new Map<string, string>();
  const nmByProduct = new Map<string, number | null>();
  for (const row of productsResult.data ?? []) {
    const id = String(row.id);
    if (row.nm_id !== null && row.nm_id !== undefined) productByNm.set(Number(row.nm_id), id);
    const article = String(row.article ?? "").trim().toLowerCase();
    if (article) productByArticle.set(article, id);
    nmByProduct.set(id, row.nm_id === null || row.nm_id === undefined ? null : Number(row.nm_id));
  }

  const resolveProduct = (entry: FbsBarcodeEntry): string | undefined =>
    productByNm.get(entry.nmId) ?? productByArticle.get(entry.article.trim().toLowerCase());

  const productIds = [...new Set([...productByNm.values(), ...productByArticle.values()])];
  const existingResult = productIds.length
    ? await db.from("product_variants").select("id, product_id, size_label, barcode, chrt_id").in("product_id", productIds)
    : { data: [], error: null };
  if (existingResult.error) return fail(existingResult.error.message, 500);

  const bySize = new Map<string, { id: string; barcode: string | null; chrtId: number | null }>();
  for (const row of existingResult.data ?? []) {
    bySize.set(`${row.product_id}|${String(row.size_label ?? "").trim().toLowerCase()}`, {
      id: String(row.id),
      barcode: (row.barcode as string | null) ?? null,
      chrtId: row.chrt_id === null ? null : Number(row.chrt_id),
    });
  }

  const toInsert: Record<string, unknown>[] = [];
  const toUpdate: { id: string; barcode: string | null; chrt_id: number | null }[] = [];
  const touchedProducts = new Set<string>();
  let skippedNoProduct = 0;
  const seen = new Set<string>();

  // Карточка нашлась по артикулу, а nmID у товара пуст — дописываем связь заодно.
  const nmToFill = new Map<string, number>();

  for (const entry of entries) {
    const productId = resolveProduct(entry);
    if (!productId) { skippedNoProduct += 1; continue; }
    if (!nmByProduct.get(productId) && entry.nmId) nmToFill.set(productId, entry.nmId);
    // Безразмерная карточка WB («0» или пусто) — это наш базовый вариант, его не дублируем.
    const size = entry.size.trim();
    if (!size || size === "0") continue;

    const key = `${productId}|${size.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    touchedProducts.add(productId);

    const existing = bySize.get(key);
    if (!existing) {
      toInsert.push({ product_id: productId, size_label: size, barcode: entry.barcode, chrt_id: entry.chrtId });
      continue;
    }
    // Уже заведённый размер не переписываем целиком: дополняем тем, чего не хватало.
    if ((existing.barcode === null && entry.barcode) || (existing.chrtId === null && entry.chrtId)) {
      toUpdate.push({
        id: existing.id,
        barcode: existing.barcode ?? entry.barcode,
        chrt_id: existing.chrtId ?? entry.chrtId,
      });
    }
  }

  for (const [productId, nmId] of nmToFill) {
    await db.from("products").update({ nm_id: nmId, updated_at: new Date().toISOString() }).eq("id", productId);
  }

  let created = 0;
  if (toInsert.length > 0) {
    // Баркод уникален глобально: если он уже висит на другом товаре, вставка этой
    // строки провалится — поэтому пишем по одной, а не пачкой, чтобы одна коллизия
    // не отменила весь импорт.
    for (const row of toInsert) {
      const { error } = await db.from("product_variants").insert(row);
      if (!error) created += 1;
    }
  }

  let updated = 0;
  for (const row of toUpdate) {
    const { error } = await db
      .from("product_variants")
      .update({ barcode: row.barcode, chrt_id: row.chrt_id, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (!error) updated += 1;
  }

  const result: VariantImportResult = {
    created,
    updated,
    linkedByArticle: nmToFill.size,
    products: touchedProducts.size,
    skippedNoProduct,
    partial,
    cabinets: cabinetStats,
  };
  return NextResponse.json({ data: result, error: null });
}
