import { NextRequest, NextResponse } from "next/server";
import { checkAssortmentCollectorAuth } from "@/lib/assortment/collectorAuth";
import { EmbeddingInputError, parseEmbeddingIngest } from "@/lib/assortment/similar";
import { writeSyncLog } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const JOB = "assortment-embed";

/**
 * Приём отпечатков от сборщика на Mac mini. Пульс сборщика — строка
 * sync_log «assortment-embed» на каждую посылку.
 */
export async function POST(request: NextRequest) {
  const authError = checkAssortmentCollectorAuth(request);
  if (authError) return authError;
  const startedAt = new Date();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  let ingest;
  try {
    ingest = parseEmbeddingIngest(await request.json().catch(() => null));
  } catch (error) {
    return NextResponse.json({ error: error instanceof EmbeddingInputError ? error.message : "Неверная посылка" }, { status: 400 });
  }
  const ids = [...ingest.items.map((i) => i.mediaId), ...ingest.failed.map((f) => f.mediaId)];
  if (ids.length === 0) return NextResponse.json({ ok: true, stored: 0 });
  const { data: media, error: mediaError } = await db.from("assortment_media").select("id,reference_id").in("id", ids);
  if (mediaError) return NextResponse.json({ error: mediaError.message }, { status: 500 });
  const referenceOf = new Map((media ?? []).map((m) => [String(m.id), String(m.reference_id)]));
  const rows = [
    ...ingest.items.filter((i) => referenceOf.has(i.mediaId)).map((i) => ({ media_id: i.mediaId, reference_id: referenceOf.get(i.mediaId), model: ingest.model, embedding: i.embedding, error: null })),
    ...ingest.failed.filter((f) => referenceOf.has(f.mediaId)).map((f) => ({ media_id: f.mediaId, reference_id: referenceOf.get(f.mediaId), model: ingest.model, embedding: null, error: f.error })),
  ];
  const { error } = await db.from("assortment_media_embeddings").upsert(rows, { onConflict: "media_id" });
  if (error) {
    await writeSyncLog(JOB, "error", null, error.message, startedAt);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await writeSyncLog(JOB, ingest.failed.length ? "partial" : "ok", ingest.items.length, ingest.failed.length ? `не прочиталось фото: ${ingest.failed.length}` : null, startedAt);
  return NextResponse.json({ ok: true, stored: rows.length });
}
