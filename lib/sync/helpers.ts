import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export function checkCronAuth(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null; // dev: skip check

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

// POST-payload к Supabase >~28КБ падает с ETIMEDOUT (сетевой лимит) — режем по ~20КБ
const CHUNK_BYTES = 20_000;

export async function chunkedUpsert(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
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
    if (bytes + size > CHUNK_BYTES) {
      const err = await flush();
      if (err) return err;
    }
    chunk.push(row);
    bytes += size;
  }
  return flush();
}

export async function writeSyncLog(
  job: string,
  status: "ok" | "error",
  rowsAffected: number | null,
  error: string | null,
  startedAt: Date,
) {
  const db = getSupabaseAdmin();
  if (!db) return;
  await db.from("sync_log").insert({
    job,
    status,
    rows_affected: rowsAffected,
    error,
    started_at: startedAt.toISOString(),
  });
}
