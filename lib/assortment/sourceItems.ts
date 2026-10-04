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

/**
 * Ключ модели (миграция 202610050002): расцветки одной модели — один ключ. Свой
 * флаг отката: нет этой колонки ≠ нет колонок каталога, фото и бренд при этом
 * писать надо по-прежнему.
 */
export const MODEL_KEY_COLUMNS = ["model_key"] as const;

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
 * Колонок ещё нет (миграция не применена): узнали — 10 минут пишем без них,
 * потом проверяем снова (миграцию могли применить, а экземпляр функции живёт
 * долго). Две независимые группы: колонки каталога и ключ модели.
 */
let catalogColumnsMissingAt = 0;
let modelKeyMissingAt = 0;
const MISSING_RECHECK_MS = 10 * 60 * 1000;
const likelyMissing = (at: number) => Date.now() - at < MISSING_RECHECK_MS;

interface Strip {
  catalog: boolean;
  modelKey: boolean;
}

/**
 * Ошибка именно про колонку из группы, а не про любую другую: PostgREST пишет
 * «Could not find the 'image_urls' column…», Postgres — «column "image_urls"…».
 */
function namesColumn(message: string | null | undefined, columns: readonly string[]): boolean {
  const text = (message ?? "").toLowerCase();
  return columns.some((c) => text.includes(`'${c}'`) || text.includes(`"${c}"`));
}

export function withoutCatalogColumns<T extends Record<string, unknown>>(row: T): T {
  const copy = { ...row };
  for (const column of CATALOG_COLUMNS) delete copy[column];
  return copy;
}

export function withoutModelKey<T extends Record<string, unknown>>(row: T): T {
  const copy = { ...row };
  for (const column of MODEL_KEY_COLUMNS) delete copy[column];
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
 * Записать строки обхода. До миграций 202610040001 и 202610050002 обход не
 * падает: недостающие поля отбрасываются, и запись повторяется.
 */
export async function upsertSourceItems(
  db: SupabaseClient,
  rows: Array<Record<string, unknown>>,
  options: UpsertOptions = {},
  strip: Strip = { catalog: likelyMissing(catalogColumnsMissingAt), modelKey: likelyMissing(modelKeyMissingAt) },
): Promise<void> {
  if (rows.length === 0) return;
  let prepared = rows;
  if (strip.catalog) prepared = prepared.map(withoutCatalogColumns);
  if (strip.modelKey) prepared = prepared.map(withoutModelKey);
  if (options.fresh) {
    const nulls: Array<string> = [...(strip.catalog ? [] : CATALOG_COLUMNS), ...(strip.modelKey ? [] : MODEL_KEY_COLUMNS)];
    prepared = prepared.map((row) => ({ ...Object.fromEntries(nulls.map((c) => [c, null])), ...row }));
  }
  const groups = options.fresh ? [prepared] : groupBySameKeys(prepared);
  for (const group of groups) {
    // Новые строки — одной записью (до 1 000: больше бывает только у первой базы огромного каталога).
    const size = options.fresh ? FRESH_BATCH : BATCH;
    for (let i = 0; i < group.length; i += size) {
      const { error } = await db.from("assortment_source_items").upsert(group.slice(i, i + size), { onConflict: "source_id,source_item_id", defaultToNull: false });
      if (!error) continue;
      if (isMissingColumnError(error)) {
        if (!strip.catalog && namesColumn(error.message, CATALOG_COLUMNS)) {
          catalogColumnsMissingAt = Date.now();
          return upsertSourceItems(db, rows, options, { ...strip, catalog: true });
        }
        if (!strip.modelKey && namesColumn(error.message, MODEL_KEY_COLUMNS)) {
          modelKeyMissingAt = Date.now();
          return upsertSourceItems(db, rows, options, { ...strip, modelKey: true });
        }
      }
      throw new Error(error.message);
    }
  }
}

/** Для тестов: забыть, что колонок не было. */
export function resetCatalogColumnsFlag(): void {
  catalogColumnsMissingAt = 0;
  modelKeyMissingAt = 0;
}

/**
 * Ключи моделей, которые источник уже отдавал (колонка model_key, миграция
 * 202610050002). Нет колонки — пустое множество: до миграции каждая расцветка
 * по-прежнему считается отдельной строкой.
 */
export async function loadKnownModelKeys(db: SupabaseClient, sourceId: string, direction?: string): Promise<Set<string>> {
  const keys = new Set<string>();
  for (let from = 0; ; from += 1000) {
    let query = db.from("assortment_source_items").select("model_key").eq("source_id", sourceId).not("model_key", "is", null);
    if (direction) query = query.eq("direction", direction);
    const { data, error } = await query.order("source_item_id", { ascending: true }).range(from, from + 999);
    if (error) {
      if (isMissingColumnError(error)) return keys;
      throw new Error(error.message);
    }
    for (const row of (data ?? []) as unknown as Array<{ model_key: string | null }>) if (row.model_key) keys.add(String(row.model_key));
    if (!data || data.length < 1000) return keys;
  }
}

/**
 * Строки, которые теперь не наши (штаны, платья, посуда по новому классификатору):
 * снимаем раздел, и они уходят из каталога сразу, а не через 30 дней без показа.
 * Сама строка остаётся в базе сравнения — повторно новинкой не станет.
 */
export async function clearDirection(db: SupabaseClient, sourceId: string, itemIds: readonly string[]): Promise<number> {
  let cleared = 0;
  for (let i = 0; i < itemIds.length; i += 200) {
    const chunk = itemIds.slice(i, i + 200);
    const { error } = await db.from("assortment_source_items").update({ direction: null }).eq("source_id", sourceId).in("source_item_id", chunk);
    if (error) throw new Error(error.message);
    cleared += chunk.length;
  }
  return cleared;
}
