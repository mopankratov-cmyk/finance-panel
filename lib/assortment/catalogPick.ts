import type { SupabaseClient } from "@supabase/supabase-js";
import type { MappedRecord } from "./brightdataCatalog";
import { createFromRecord } from "./brightdataCrawl";
import { catalogProductUrl } from "./catalog";
import type { AssortmentDirection } from "./constants";
import { isMissingColumnError } from "./errors";
import { remoteImage, storeImages, type ImageBytes } from "./importer";
import { isReferenceStatus, type ReferenceStatus } from "./decisions";
import { applyDecision } from "./model";
import { RU_SHOPS } from "./ruShops";

/**
 * «Отобрать» из каталога бренда: строка обхода становится находкой (карточка
 * модели, сравнение, похожие, подборки, «где купить образец») со статусом
 * «Отобрана». Идемпотентно: повторное нажатие вернёт ту же находку; ключ
 * дедупликации — тот же, что у новинок обхода, так что дублей не будет.
 */

export class CatalogPickError extends Error {}

interface Row {
  source_id: string;
  source_item_id: string;
  handle: string | null;
  title: string | null;
  product_type: string | null;
  direction: string | null;
  first_seen_at: string;
  reference_id: string | null;
  image_urls?: string[] | null;
  brand?: string | null;
  badges?: string[] | null;
}

const BASE = "source_id,source_item_id,handle,title,product_type,direction,first_seen_at,reference_id";

async function readRow(db: SupabaseClient, sourceId: string, itemId: string): Promise<Row | null> {
  const run = (columns: string) => db.from("assortment_source_items").select(columns).eq("source_id", sourceId).eq("source_item_id", itemId).maybeSingle();
  let result = await run(`${BASE},image_urls,brand,badges`);
  if (result.error && isMissingColumnError(result.error)) result = await run(BASE);
  if (result.error) throw new Error(result.error.message);
  return (result.data as unknown as Row | null) ?? null;
}

/** Сайт не пускает облако (магазины через mini): фото отобранной модели принесёт mini. */
export function photosViaMini(sourceId: string): boolean {
  return RU_SHOPS.some((s) => s.sourceId === sourceId && s.via === "mini");
}

export interface PickResult {
  referenceId: string;
  direction: AssortmentDirection;
  created: boolean;
  /** Решение «Отобрать» действительно применено (модель была новой или отложенной). */
  decided: boolean;
  /** Статус находки после нажатия — его и показывает карточка каталога. */
  status: ReferenceStatus;
  /** Ссылки на фото, которые нужно скачать после ответа (облачные сайты). */
  photoUrls: string[];
}

/** «Отобрать» двигает вперёд только новую и отложенную: образец и подборку назад не откатываем. */
const PICKABLE: ReferenceStatus[] = ["new", "watching"];

async function selectIfPickable(db: SupabaseClient, referenceId: string, author: string): Promise<{ decided: boolean; status: ReferenceStatus }> {
  const { data: ref, error } = await db.from("assortment_references").select("status,version").eq("id", referenceId).maybeSingle();
  if (error) throw new Error(error.message);
  const status: ReferenceStatus = isReferenceStatus(ref?.status) ? ref.status : "new";
  if (!ref || !PICKABLE.includes(status)) return { decided: false, status };
  const result = await applyDecision(db, referenceId, { action: "selected", expectedVersion: Number(ref.version), reason: "отобрано из каталога бренда", author });
  return { decided: true, status: result.status };
}

export async function pickCatalogItem(db: SupabaseClient, input: { sourceId: string; itemId: string }, author: string): Promise<PickResult> {
  const row = await readRow(db, input.sourceId, input.itemId);
  if (!row || (row.direction !== "bags" && row.direction !== "jackets")) throw new CatalogPickError("Модель не найдена в каталоге");
  const direction = row.direction as AssortmentDirection;
  // Уже находка (новинка обхода, вставленная руками ссылка): применяем решение к ней же.
  if (row.reference_id) return { referenceId: row.reference_id, direction, created: false, photoUrls: [], ...await selectIfPickable(db, row.reference_id, author) };

  const { data: source, error: sourceError } = await db.from("assortment_sources").select("name,seed_urls").eq("source_id", input.sourceId).maybeSingle();
  if (sourceError) throw new Error(sourceError.message);
  const seeds = Array.isArray(source?.seed_urls) ? (source.seed_urls as unknown[]).filter((s): s is string => typeof s === "string" && /^https?:\/\//.test(s)) : [];
  const url = catalogProductUrl(row.handle, seeds[0] ?? null);
  if (!url) throw new CatalogPickError("У модели нет ссылки на сайт бренда");

  const record: MappedRecord = {
    sourceItemId: row.source_item_id,
    url,
    title: (row.title ?? "").trim() || "Без названия",
    brand: row.brand ?? source?.name ?? null,
    category: row.product_type ?? "",
    color: null,
    images: row.image_urls ?? [],
    reviews: null,
    rating: null,
  };
  // Фото — после ответа (не держим человека 4×12 с), у сайтов через mini — с mini.
  const created = await createFromRecord(db, { sourceId: input.sourceId, name: source?.name ?? input.sourceId }, direction, record, "catalog_pick", Date.now() + 8_000, {
    origin: "catalog_pick",
    firstSeenAt: row.first_seen_at,
    cloudPhotos: false,
  });

  if (created.created && row.badges?.length) {
    const now = new Date().toISOString();
    // Метка сайта — заявление ритейлера, а не наблюдение системы (как у импорта Shopify).
    const base = { reference_id: created.referenceId, method: "catalog_pick", source_url: url, observed_at: now, created_by: "crawler", group_kind: "retail", status: "retailer_claim" };
    const badges = [
      ...(row.badges.includes("new") ? [{ ...base, metric: "new_badge", value_text: "новинка" }] : []),
      ...(row.badges.includes("bestseller") ? [{ ...base, metric: "bestseller_badge", value_text: "бестселлер" }] : []),
    ];
    if (badges.length) await db.from("assortment_observations").insert(badges);
  }
  await db.from("assortment_source_items").update({ reference_id: created.referenceId }).eq("source_id", input.sourceId).eq("source_item_id", input.itemId);

  // «Отобрать» — решение человека с версией карточки; образец и подборку назад не откатываем.
  const decision = await selectIfPickable(db, created.referenceId, author);
  return {
    referenceId: created.referenceId,
    direction,
    created: created.created,
    ...decision,
    photoUrls: created.created && !photosViaMini(input.sourceId) ? (row.image_urls ?? []).slice(0, 2) : [],
  };
}

/** Фото отобранной модели — после ответа, первые 2 (облачные сайты). */
export async function storePickPhotos(db: SupabaseClient, referenceId: string, urls: string[]): Promise<number> {
  const images: ImageBytes[] = [];
  for (const url of urls) {
    const image = await remoteImage(url);
    if (image) images.push(image);
  }
  return images.length ? storeImages(db, referenceId, images, false) : 0;
}

/**
 * «Не интересно»: модель уходит из выдачи каталога, но остаётся в базе сравнения.
 * Скрывается МОДЕЛЬ целиком — все её расцветки (ключ модели, миграция
 * 202610050002), иначе скрытый цвет заменил бы собой соседний. Нет ключа (миграции
 * нет или строка из источника «одна строка = модель») — скрываем одну строку.
 */
export async function hideCatalogItem(db: SupabaseClient, input: { sourceId: string; itemId: string; hidden: boolean }): Promise<"ok" | "not_found" | "migration_missing"> {
  const patch = { hidden_at: input.hidden ? new Date().toISOString() : null };
  const keyed = await db.from("assortment_source_items").select("model_key,direction").eq("source_id", input.sourceId).eq("source_item_id", input.itemId).maybeSingle();
  const key = !keyed.error ? (keyed.data as { model_key?: string | null; direction?: string | null } | null) : null;
  if (keyed.error && !isMissingColumnError(keyed.error)) throw new Error(keyed.error.message);
  const modelKeyValue = key?.model_key ?? null;
  const { data, error } = modelKeyValue && key?.direction
    ? await db.from("assortment_source_items").update(patch).eq("source_id", input.sourceId).eq("direction", key.direction).eq("model_key", modelKeyValue).select("source_id")
    : await db.from("assortment_source_items").update(patch).eq("source_id", input.sourceId).eq("source_item_id", input.itemId).select("source_id");
  if (error && isMissingColumnError(error)) return "migration_missing";
  if (error) throw new Error(error.message);
  return data && data.length > 0 ? "ok" : "not_found";
}
