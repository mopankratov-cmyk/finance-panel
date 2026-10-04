import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumnError } from "./errors";

/**
 * Строки обхода (assortment_source_items) — база сравнения и каталог брендов.
 *
 * С миграции 202610040001 у строки есть ссылки на фото с сайта бренда, бренд и
 * метки сайта — по ним панель показывает «Каталоги брендов». Файлы фото не
 * копируем: только ссылки. Цен здесь нет.
 */

/** Колонки каталога из миграции 202610040001. */
export const CATALOG_COLUMNS = ["image_urls", "brand", "badges"] as const;

export type CatalogBadge = "new" | "bestseller";

const MAX_IMAGE_URLS = 4;
const BATCH = 500;
const FRESH_BATCH = 1000;

/**
 * Поля каталога для строки. Фото и бренд — только непустые: обход без фото не
 * должен затереть фото, собранные прошлым обходом. Метки — по `badgesKnown`:
 * обход Shopify читает теги целиком, и «меток нет» — это знание (пишем null,
 * иначе снятая брендом «новинка» висела бы вечно).
 */
export function catalogFields(input: {
  images?: string[] | null;
  /** Запись полная (готовый набор): «фото нет» — знание, старые ссылки снимаются (мёртвые Zara). */
  imagesKnown?: boolean;
  brand?: string | null;
  badges?: CatalogBadge[] | null;
  badgesKnown?: boolean;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const images = [...new Set((input.images ?? []).filter((u) => typeof u === "string" && /^https:\/\//.test(u)))].slice(0, MAX_IMAGE_URLS);
  if (images.length) out.image_urls = images;
  else if (input.imagesKnown) out.image_urls = null;
  const brand = input.brand?.trim();
  if (brand) out.brand = brand.slice(0, 120);
  const badges = [...new Set(input.badges ?? [])];
  if (badges.length) out.badges = badges;
  else if (input.badgesKnown) out.badges = null;
  return out;
}

/**
 * Пачки с одинаковым набором полей. supabase-js в пачке с разным набором ключей
 * проставит отсутствующие как значение по умолчанию (null) — и затёр бы фото
 * или флаг базы у части строк.
 */
export function groupBySameKeys<T extends Record<string, unknown>>(rows: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = Object.keys(row).sort().join(",");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()];
}

/**
 * Колонок каталога ещё нет (миграция не применена): узнали — 10 минут пишем
 * без них, потом проверяем снова (миграцию могли применить, а экземпляр
 * функции живёт долго).
 */
let catalogColumnsMissingAt = 0;
const MISSING_RECHECK_MS = 10 * 60 * 1000;
const catalogColumnsLikelyMissing = () => Date.now() - catalogColumnsMissingAt < MISSING_RECHECK_MS;

/**
 * Ошибка именно про колонку каталога, а не про любую другую: PostgREST пишет
 * «Could not find the 'image_urls' column…», Postgres — «column "image_urls"…».
 */
function namesCatalogColumn(message: string | null | undefined): boolean {
  const text = (message ?? "").toLowerCase();
  return CATALOG_COLUMNS.some((c) => text.includes(`'${c}'`) || text.includes(`"${c}"`));
}

export function withoutCatalogColumns<T extends Record<string, unknown>>(row: T): T {
  const copy = { ...row };
  for (const column of CATALOG_COLUMNS) delete copy[column];
  return copy;
}

export interface UpsertOptions {
  /**
   * Новые строки (база, новинки): один набор полей у всех — недостающие поля
   * каталога явным null — и одна запись. Тогда база раздела ложится целиком или
   * никак: недописанная половина не станет «новинками» при следующем обходе.
   * Затирать нечего: строки новые по построению.
   */
  fresh?: boolean;
}

/**
 * Записать строки обхода. До миграции 202610040001 обход не падает: поля
 * каталога отбрасываются, и запись повторяется.
 */
export async function upsertSourceItems(db: SupabaseClient, rows: Array<Record<string, unknown>>, options: UpsertOptions = {}, strip = catalogColumnsLikelyMissing()): Promise<void> {
  if (rows.length === 0) return;
  let prepared = strip ? rows.map(withoutCatalogColumns) : rows;
  if (options.fresh && !strip) prepared = prepared.map((row) => ({ ...Object.fromEntries(CATALOG_COLUMNS.map((c) => [c, null])), ...row }));
  const groups = options.fresh ? [prepared] : groupBySameKeys(prepared);
  for (const group of groups) {
    // Новые строки — одной записью (до 1 000: больше бывает только у первой базы огромного каталога).
    const size = options.fresh ? FRESH_BATCH : BATCH;
    for (let i = 0; i < group.length; i += size) {
      const { error } = await db.from("assortment_source_items").upsert(group.slice(i, i + size), { onConflict: "source_id,source_item_id", defaultToNull: false });
      if (!error) continue;
      if (!strip && isMissingColumnError(error) && namesCatalogColumn(error.message)) {
        catalogColumnsMissingAt = Date.now();
        return upsertSourceItems(db, rows, options, true);
      }
      throw new Error(error.message);
    }
  }
}

/** Для тестов: забыть, что колонок не было. */
export function resetCatalogColumnsFlag(): void {
  catalogColumnsMissingAt = 0;
}
