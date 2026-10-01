import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Приватное хранилище медиа модуля (ТЗ §11): бакет закрыт, файлы отдаются
 * только короткими подписанными ссылками после проверки доступа на сервере.
 */
export const ASSORTMENT_BUCKET = "assortment-media";
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export const SIGNED_URL_TTL_SECONDS = 15 * 60;

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

let bucketReady = false;

export async function ensureAssortmentBucket(db: SupabaseClient): Promise<void> {
  if (bucketReady) return;
  const { data } = await db.storage.getBucket(ASSORTMENT_BUCKET);
  const settings = { public: false, fileSizeLimit: MAX_IMAGE_BYTES, allowedMimeTypes: [...IMAGE_MIME] };
  if (!data) {
    const { error } = await db.storage.createBucket(ASSORTMENT_BUCKET, settings);
    if (error && !/already exists/i.test(error.message)) throw new Error(`Хранилище медиа не создано: ${error.message}`);
  } else if (data.public) {
    await db.storage.updateBucket(ASSORTMENT_BUCKET, settings);
  }
  bucketReady = true;
}

export function extensionFor(mime: string): string {
  return EXT[mime] ?? "bin";
}

/** Путь загрузки с телефона или компьютера до разбора: uploads/<дата>/<uuid>.<ext>. */
export function uploadPath(mime: string, now = new Date()): string {
  return `uploads/${now.toISOString().slice(0, 10)}/${randomUUID()}.${extensionFor(mime)}`;
}

export function isUploadPath(value: unknown): value is string {
  return typeof value === "string" && /^uploads\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(value);
}

/** Окончательный путь фото модели: refs/<id модели>/<sha256>.<ext>. */
export function referenceMediaPath(referenceId: string, sha256: string, mime: string): string {
  return `refs/${referenceId}/${sha256}.${extensionFor(mime)}`;
}

export async function signedUrls(db: SupabaseClient, paths: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  const result = new Map<string, string>();
  if (unique.length === 0) return result;
  const { data } = await db.storage.from(ASSORTMENT_BUCKET).createSignedUrls(unique, SIGNED_URL_TTL_SECONDS);
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) result.set(item.path, item.signedUrl);
  }
  return result;
}
