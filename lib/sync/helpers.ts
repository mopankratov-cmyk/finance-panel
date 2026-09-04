import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
// Тот же список читает кнопка в браузере — иначе она снова разойдётся с сервером.
import { canRunSyncManually } from "@/lib/sync/manualRunRoles";


export async function checkCronAuth(request: NextRequest): Promise<NextResponse | null> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null; // dev: skip check

  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return null;

  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (session && canRunSyncManually(session.role)) return null;

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

// Дефолт 20КБ: в локальной песочнице POST >~28КБ к Supabase ловил ETIMEDOUT.
// На Vercel→Supabase лимит выше — для бэкфилла (десятки тысяч строк) передаём крупнее,
// чтобы резко сократить число round-trip'ов и уложиться в 60с функции.
const CHUNK_BYTES = 20_000;

export async function chunkedUpsert(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  chunkBytes: number = CHUNK_BYTES,
): Promise<string | null> {
  const db = getSupabaseAdmin();
  if (!db) return "Supabase не настроен";

  let chunk: Record<string, unknown>[] = [];
  let bytes = 0;
  let chunkNum = 0;

  const flush = async (): Promise<string | null> => {
    if (!chunk.length) return null;
    chunkNum++;
    let lastError = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));
      const { error } = await db.from(table).upsert(chunk, { onConflict });
      if (!error) {
        chunk = [];
        bytes = 0;
        return null;
      }
      lastError = error.message;
      if (!lastError.includes("fetch failed")) break;
    }
    return `${lastError} (chunk ${chunkNum})`;
  };

  for (const row of rows) {
    const size = JSON.stringify(row).length;
    if (bytes + size > chunkBytes) {
      const err = await flush();
      if (err) return err;
    }
    chunk.push(row);
    bytes += size;
  }
  return flush();
}

function missingOptionalColumn(error: string, column: string): boolean {
  const quoted = [`"${column}"`, `'${column}'`, column];
  return /schema cache|column|Could not find/i.test(error)
    && quoted.some((needle) => error.toLowerCase().includes(needle.toLowerCase()));
}

export async function chunkedUpsertWithOptionalColumns(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  optionalColumns: string[],
  chunkBytes: number = CHUNK_BYTES,
): Promise<{ error: string | null; skippedColumns: string[] }> {
  let currentRows = rows;
  const skippedColumns: string[] = [];

  for (let attempt = 0; attempt <= optionalColumns.length; attempt++) {
    const error = await chunkedUpsert(table, currentRows, onConflict, chunkBytes);
    if (!error) return { error: null, skippedColumns };

    const missing = optionalColumns.find((column) => !skippedColumns.includes(column) && missingOptionalColumn(error, column));
    if (!missing) return { error, skippedColumns };

    skippedColumns.push(missing);
    currentRows = currentRows.map((row) => {
      const copy = { ...row };
      delete copy[missing];
      return copy;
    });
  }

  return { error: `Не удалось записать ${table}: отсутствуют колонки ${skippedColumns.join(", ")}`, skippedColumns };
}

// Найдено аудитом данных/API 2026-07-08: апсерт в целевую таблицу проходил, а сама
// запись в sync_log — нет (эта функция не проверяла { error } от Supabase и не
// ретраила транзиентные сбои), из-за чего страница /sync врала про "остановку" синка,
// когда данные на самом деле шли. Ретраим как chunkedUpsert + логируем в консоль
// (видно в логах Vercel), если после ретраев всё равно не удалось записать.
export async function writeSyncLog(
  job: string,
  // «partial» — работа началась и не доделана до конца (упёрлись в бюджет
  // времени, в лимит площадки, в предел страниц). Это отдельное состояние:
  // выдавать его за «ok» значит рапортовать об успехе там, где хвост остался.
  status: "ok" | "partial" | "error",
  rowsAffected: number | null,
  error: string | null,
  startedAt: Date,
) {
  const db = getSupabaseAdmin();
  if (!db) return;
  const row = {
    job,
    status,
    rows_affected: rowsAffected,
    error,
    started_at: startedAt.toISOString(),
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * attempt));
    const { error: insertError } = await db.from("sync_log").insert(row);
    if (!insertError) return;
    if (attempt === 2) console.error(`[sync_log] insert failed for job=${job}:`, insertError.message);
  }
}
