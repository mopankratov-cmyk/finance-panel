import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sniffImageMime } from "@/lib/ctrtest/pinImage";
import type { AssortmentDirection } from "./constants";
import {
  dedupKey,
  detectSourceId,
  extractHtmlProduct,
  fallbackTitle,
  normalizeProductUrl,
  parseShopifyProduct,
  regionFromUrl,
  shopifyProductJsonUrl,
  type ExtractedProduct,
} from "./extract";
import { parsePublicUrl, safeFetch, SafeFetchError } from "./safeFetch";
import { ASSORTMENT_BUCKET, ensureAssortmentBucket, isUploadPath, MAX_IMAGE_BYTES, referenceMediaPath } from "./storage";

export interface ImportInput {
  direction: AssortmentDirection;
  url?: string | null;
  title?: string | null;
  note?: string | null;
  uploads?: string[];
  /** Находку принёс автообход каталога, а не человек. */
  via?: "crawl";
}

export interface ImportResult {
  referenceId: string;
  created: boolean;
  title: string;
  images: number;
  sourceId: string | null;
  warnings: string[];
}

/** Ошибка, которую пользователь должен исправить сам (400), а не сбой сервера. */
export class ImportInputError extends Error {}

const PAGE_LIMIT = { maxBytes: 3 * 1024 * 1024, timeoutMs: 10_000 };
const IMAGE_BUDGET_MS = 30_000;
const MAX_IMAGES = 6;

async function loadSourcesForDetection(db: SupabaseClient) {
  const { data, error } = await db.from("assortment_sources").select("source_id,name,seed_urls");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    sourceId: String(row.source_id),
    name: String(row.name ?? ""),
    seedUrls: Array.isArray(row.seed_urls) ? row.seed_urls.map(String) : [],
  }));
}

async function readProduct(url: string, warnings: string[]): Promise<ExtractedProduct | null> {
  const shopifyJson = shopifyProductJsonUrl(url);
  if (shopifyJson) {
    try {
      const response = await safeFetch(shopifyJson, { ...PAGE_LIMIT, accept: "application/json" });
      const parsed = parseShopifyProduct(JSON.parse(response.body.toString("utf8")));
      if (parsed) return parsed;
    } catch (error) {
      if (error instanceof SafeFetchError && error.code === "blocked_host") throw error;
      // не Shopify или карточка закрыта — пробуем обычную страницу
    }
  }
  try {
    const page = await safeFetch(url, { ...PAGE_LIMIT, accept: "text/html,application/xhtml+xml" });
    if (!/html/i.test(page.contentType)) {
      warnings.push("По ссылке не страница товара: сохранили ссылку как есть.");
      return null;
    }
    return extractHtmlProduct(page.body.toString("utf8"), page.url);
  } catch (error) {
    if (error instanceof SafeFetchError) {
      if (error.code === "blocked_host" || error.code === "bad_url") throw error;
      if (error.status === 403 || error.status === 429) {
        warnings.push(`Сайт закрыт для автоматического чтения (код ${error.status}): ссылка сохранена, приложите фото или скриншот.`);
      } else {
        warnings.push(`Страницу прочитать не удалось: ${error.message}. Ссылка сохранена, приложите фото.`);
      }
      return null;
    }
    throw error;
  }
}

export interface ImageBytes {
  bytes: Buffer;
  mime: string;
  originUrl: string | null;
  uploadPath: string | null;
}

async function remoteImage(url: string): Promise<ImageBytes | null> {
  try {
    const response = await safeFetch(url, { maxBytes: MAX_IMAGE_BYTES, timeoutMs: 12_000, accept: "image/webp,image/jpeg,image/png;q=0.9,*/*;q=0.5" });
    const mime = sniffImageMime(response.body);
    return mime ? { bytes: response.body, mime, originUrl: response.url, uploadPath: null } : null;
  } catch {
    return null;
  }
}

export async function uploadedImage(db: SupabaseClient, path: string): Promise<ImageBytes | null> {
  const { data, error } = await db.storage.from(ASSORTMENT_BUCKET).download(path);
  if (error || !data) return null;
  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) return null;
  const mime = sniffImageMime(bytes);
  return mime ? { bytes, mime, originUrl: null, uploadPath: path } : null;
}

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export async function storeImages(db: SupabaseClient, referenceId: string, images: ImageBytes[], manual: boolean): Promise<number> {
  const { data: existing } = await db.from("assortment_media").select("sha256,position").eq("reference_id", referenceId);
  const known = new Set((existing ?? []).map((row) => String(row.sha256)));
  let position = (existing ?? []).reduce((max, row) => Math.max(max, Number(row.position ?? 0) + 1), 0);
  let stored = 0;
  for (const image of images) {
    const hash = sha256(image.bytes);
    if (known.has(hash)) continue;
    const path = referenceMediaPath(referenceId, hash, image.mime);
    const { error: uploadError } = await db.storage.from(ASSORTMENT_BUCKET).upload(path, image.bytes, { contentType: image.mime, upsert: true });
    if (uploadError) continue;
    const { error: rowError } = await db.from("assortment_media").insert({
      reference_id: referenceId,
      kind: "image",
      position,
      storage_path: path,
      origin_url: image.originUrl,
      sha256: hash,
      is_manual: manual,
    });
    if (rowError) continue;
    known.add(hash);
    position += 1;
    stored += 1;
  }
  return stored;
}

export async function importReference(db: SupabaseClient, input: ImportInput, actorId: string | null): Promise<ImportResult> {
  const uploads = (input.uploads ?? []).filter(isUploadPath).slice(0, MAX_IMAGES);
  const rawUrl = (input.url ?? "").trim();
  if (!rawUrl && uploads.length === 0) throw new ImportInputError("Нужна ссылка или хотя бы одно фото.");
  await ensureAssortmentBucket(db);

  const warnings: string[] = [];
  let url = "";
  let product: ExtractedProduct | null = null;
  let sourceId: string | null = null;
  let sourceName: string | null = null;
  let region = "";
  if (rawUrl) {
    try {
      url = parsePublicUrl(rawUrl).toString();
    } catch (error) {
      throw new ImportInputError(error instanceof Error ? error.message : "Ссылка не распознана");
    }
    const sources = await loadSourcesForDetection(db);
    sourceId = detectSourceId(url, sources);
    sourceName = sources.find((s) => s.sourceId === sourceId)?.name ?? null;
    region = regionFromUrl(url);
    try {
      product = await readProduct(url, warnings);
    } catch (error) {
      if (error instanceof SafeFetchError) throw new ImportInputError(error.message);
      throw error;
    }
    // Автообход не создаёт карточку-пустышку без названия и фото: не
    // прочиталась — останется в очереди до следующего прогона.
    if (input.via === "crawl" && !product?.title) throw new ImportInputError(warnings[0] ?? "Карточка товара не прочиталась");
  }

  const deadline = Date.now() + IMAGE_BUDGET_MS;
  const uploaded: ImageBytes[] = [];
  for (const path of uploads) {
    const image = await uploadedImage(db, path);
    if (image) uploaded.push(image);
    else warnings.push("Одно из фото не прочиталось как JPEG, PNG или WebP — пропущено.");
  }

  const normalizedUrl = url ? normalizeProductUrl(product?.canonicalUrl ?? url) : "";
  const key = url
    ? dedupKey(sourceId, region, product?.sourceItemId ?? null, normalizedUrl)
    : uploaded[0] ? `manual||photo:${sha256(uploaded[0].bytes)}` : null;
  if (!key) throw new ImportInputError("Фото не прочиталось: нужен JPEG, PNG или WebP до 10 МБ.");

  const { data: existing } = await db.from("assortment_references").select("id,title").eq("dedup_key", key).maybeSingle();
  let referenceId: string;
  let created = false;
  let title: string;
  const now = new Date().toISOString();
  if (existing) {
    referenceId = String(existing.id);
    title = String(existing.title ?? "");
    await db.from("assortment_references").update({ last_seen_at: now, updated_at: now }).eq("id", referenceId);
    warnings.push("Эта модель уже есть в ленте — новые фото добавлены к ней.");
  } else {
    title = (input.title ?? "").trim() || product?.title || (url ? fallbackTitle(url) : "Находка по фото");
    const attributes: Record<string, unknown> = {};
    if (product?.productType) attributes.category = { value: product.productType, origin: "published" };
    if (product?.colors.length) attributes.colors = { value: product.colors, origin: "published" };
    if (input.note?.trim()) attributes.note = { value: input.note.trim().slice(0, 1000), origin: "manual" };
    const { data: inserted, error } = await db.from("assortment_references").insert({
      direction: input.direction,
      source_id: sourceId,
      region,
      source_item_id: product?.sourceItemId ?? null,
      url: normalizedUrl,
      dedup_key: key,
      article: product?.article ?? null,
      title,
      brand: product?.brand ?? sourceName,
      attributes,
      published_at: product?.publishedAt ?? null,
      created_by: actorId,
    }).select("id").single();
    if (error || !inserted) throw new Error(error?.message ?? "Модель не сохранилась");
    referenceId = String(inserted.id);
    created = true;

    const method = input.via === "crawl" ? "crawl_shopify" : url ? "import_url" : "import_manual";
    const observations: Array<Record<string, unknown>> = [
      { reference_id: referenceId, group_kind: "novelty", metric: "first_seen", value_text: now, method, status: "observed", source_url: url || null, observed_at: now, created_by: actorId },
    ];
    if (product?.publishedAt) {
      observations.push({ reference_id: referenceId, group_kind: "novelty", metric: "published_at", value_text: product.publishedAt, method: "shopify_published_at", status: "retailer_claim", source_url: url, observed_at: now, created_by: actorId });
    }
    if (product?.newBadge) {
      observations.push({ reference_id: referenceId, group_kind: "retail", metric: "new_badge", value_text: product.newBadge, method: "shopify_tags", status: "retailer_claim", source_url: url, observed_at: now, created_by: actorId });
    }
    if (product?.bestsellerBadge) {
      observations.push({ reference_id: referenceId, group_kind: "retail", metric: "bestseller_badge", value_text: product.bestsellerBadge, method: "shopify_tags", status: "retailer_claim", source_url: url, observed_at: now, created_by: actorId });
    }
    const { error: observationsError } = await db.from("assortment_observations").insert(observations);
    if (observationsError) warnings.push(`Модель сохранена, но признаки новизны не записались: ${observationsError.message}`);
  }

  const remote: ImageBytes[] = [];
  for (const imageUrl of product?.images ?? []) {
    if (Date.now() > deadline) {
      warnings.push("Часть фото не успела загрузиться — их можно добавить вручную.");
      break;
    }
    const image = await remoteImage(imageUrl);
    if (image) remote.push(image);
  }
  const images = (await storeImages(db, referenceId, remote, false)) + (await storeImages(db, referenceId, uploaded, true));
  if (uploaded.length > 0) {
    await db.storage.from(ASSORTMENT_BUCKET).remove(uploaded.map((u) => u.uploadPath).filter((p): p is string => Boolean(p)));
  }
  if (created && images === 0) warnings.push("Фото нет: приложите снимок модели, чтобы она появилась в галерее с картинкой.");

  return { referenceId, created, title, images, sourceId, warnings };
}
