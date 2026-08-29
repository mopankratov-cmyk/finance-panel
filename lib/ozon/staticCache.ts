import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { decodeCompressedJson, encodeCompressedJson } from "@/lib/cache/compressedJson";
import { ozonImages, ozonPrices, ozonSellerStocks, ozonStocks, type OzonCreds } from "@/lib/ozon/api";

/**
 * Кэш статики кабинета Ozon: цены, картинки, остатки.
 *
 * Эти три ответа не зависят от периода, но каждая сборка любого экрана
 * кокпита ходила за ними к Ozon живьём — вместе с посуточной аналитикой и
 * транзакциями выходило семь сетевых вызовов и 10–12 секунд на каждый
 * новый период или кабинет. Смена периода не меняет ни цен, ни картинок,
 * ни остатков — им хватает свежести в десять минут.
 *
 * Живёт в базе (та же таблица, что снимки кокпита), а не в памяти
 * процесса: кэш инстанса умирает с деплоем и не виден соседям.
 */
const STATIC_TTL_MS = 10 * 60_000;

async function cached<T>(kind: string, clientId: string, load: () => Promise<T>): Promise<T> {
  const db = getSupabaseAdmin();
  const key = `static:${kind}:${clientId}`;
  if (db) {
    const { data } = await db
      .from("ozon_cockpit_cache")
      .select("payload, generated_at")
      .eq("cache_key", key)
      .maybeSingle();
    const age = data?.generated_at ? Date.now() - Date.parse(String(data.generated_at)) : Number.POSITIVE_INFINITY;
    if (age < STATIC_TTL_MS && typeof data?.payload === "string") {
      try {
        return decodeCompressedJson<T>(data.payload);
      } catch {
        // повреждённый снимок — просто пересобираем
      }
    }
  }
  const value = await load();
  // Отказ Ozon не кэшируем: пустой ответ с флагом ok=false должен уйти
  // пользователю один раз, а не залипнуть на десять минут.
  const failed = (value as { ok?: boolean } | null)?.ok === false;
  if (db && !failed) {
    await db.from("ozon_cockpit_cache").upsert(
      { cache_key: key, payload: encodeCompressedJson(value), generated_at: new Date().toISOString() },
      { onConflict: "cache_key" },
    );
  }
  return value;
}

export function cachedOzonPrices(creds: OzonCreds): ReturnType<typeof ozonPrices> {
  return cached("prices", creds.clientId, () => ozonPrices(creds));
}

export function cachedOzonImages(creds: OzonCreds): ReturnType<typeof ozonImages> {
  // Ключ поднят до v2: прежние снимки могли содержать пустой справочник,
  // сохранённый после сбоя Ozon, — на нём обнулялись реклама и себестоимость.
  return cached("images-v2", creds.clientId, () => ozonImages(creds));
}

/**
 * Остатки кабинета целиком: склады Ozon плюс собственный склад продавца.
 *
 * Раньше кокпит знал только склады Ozon, и товар, который возят по FBS,
 * выглядел закончившимся: он исчезал с экрана «Остатки», а «Обзор» выдавал
 * по нему критикал «нет остатка».
 *
 * Отказ FBS-части не роняет остатки целиком — склады Ozon отдаются как есть,
 * а причина уходит в предупреждения экрана.
 */
export function cachedOzonStocks(creds: OzonCreds): ReturnType<typeof ozonStocks> {
  return cached("stocks-v2", creds.clientId, async () => {
    const [warehouses, seller] = await Promise.all([ozonStocks(creds), ozonSellerStocks(creds)]);
    if (!warehouses.ok) return warehouses;
    if (!seller.ok) {
      return { ok: true as const, rows: warehouses.rows, sellerStocksError: seller.error };
    }
    return { ok: true as const, rows: [...warehouses.rows, ...seller.rows] };
  });
}
