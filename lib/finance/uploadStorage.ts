// Большие файлы (сканы договоров, PDF-выписки) идут в Supabase Storage напрямую
// из браузера по подписанному URL, минуя наш API: у Vercel потолок 4,5 МБ на
// тело запроса serverless-функции, и файл крупнее упирался в него до нашего
// кода. Сервер выдаёт «билет» (подписанный URL на один объект), браузер делает
// PUT, затем зовёт распознавание с путём объекта. Объект удаляется после разбора.

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const UPLOADS_BUCKET = "finance-uploads";
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** Порог, начиная с которого браузер идёт через хранилище, а не multipart. */
export const DIRECT_UPLOAD_THRESHOLD_BYTES = 3_500_000;

const ALLOWED_EXTENSIONS = new Set(["pdf", "xlsx", "docx", "doc", "jpg", "jpeg", "png", "gif", "webp", "csv", "txt"]);

/** Путь объекта: uuid + безопасное имя с расширением из исходного файла. */
export function uploadObjectPath(fileName: string): string {
  const clean = fileName.normalize("NFC").replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/_+/g, "_").slice(-120) || "file";
  const extension = clean.includes(".") ? clean.split(".").pop()!.toLowerCase() : "";
  if (!ALLOWED_EXTENSIONS.has(extension)) throw new Error("Поддерживаются PDF, XLSX, DOCX, изображения и CSV");
  return `${new Date().toISOString().slice(0, 10)}/${randomUUID()}/${clean}`;
}

export function isUploadObjectPath(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\/[^/]{1,160}$/.test(value);
}

async function ensureUploadsBucket(db: SupabaseClient) {
  const { data, error } = await db.storage.getBucket(UPLOADS_BUCKET);
  if (data) return;
  if (error && !/not found|does not exist/i.test(error.message)) throw new Error(`Хранилище загрузок: ${error.message}`);
  const created = await db.storage.createBucket(UPLOADS_BUCKET, { public: false, fileSizeLimit: MAX_UPLOAD_BYTES });
  if (created.error && !/already exists/i.test(created.error.message)) throw new Error(`Не удалось создать хранилище загрузок: ${created.error.message}`);
}

export async function createUploadTicket(db: SupabaseClient, fileName: string): Promise<{ path: string; signedUrl: string; token: string }> {
  await ensureUploadsBucket(db);
  const path = uploadObjectPath(fileName);
  const { data, error } = await db.storage.from(UPLOADS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`Не удалось выдать ссылку на загрузку: ${error?.message ?? "нет данных"}`);
  return { path, signedUrl: data.signedUrl, token: data.token };
}

export async function readUpload(db: SupabaseClient, path: string): Promise<Buffer> {
  const { data, error } = await db.storage.from(UPLOADS_BUCKET).download(path);
  if (error || !data) throw new Error(`Файл не найден в хранилище: ${error?.message ?? path}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function removeUpload(db: SupabaseClient, path: string): Promise<void> {
  await db.storage.from(UPLOADS_BUCKET).remove([path]).then(() => undefined, () => undefined);
}
