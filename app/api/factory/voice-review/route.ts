import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

function text(value: unknown, max = 180): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function indexes(value: unknown): number[] {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[,\s;]+/);
  return Array.from(new Set(raw
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0 && item <= 20)));
}

function ids(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[,\s;]+/);
  return Array.from(new Set(raw
    .map((item) => text(item, 120))
    .filter(Boolean)));
}

type SignalRow = {
  id?: number;
  created_at?: string;
  reason_chip?: string | null;
  params?: Record<string, unknown> | null;
};

export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    const limit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 20));
    const batchId = text(req.nextUrl.searchParams.get("batch_id"), 80);

    let q = db
      .from("cf_signals")
      .select("id,created_at,reason_chip,params")
      .eq("event", "voice_review_selected")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (batchId) q = q.filter("params->>batch_id", "eq", batchId);

    const { data, error } = await q;
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const selections = ((data || []) as SignalRow[]).map((row) => ({
      id: row.id,
      created_at: row.created_at,
      batch_id: text(row.params?.batch_id, 80) || null,
      selected_indexes: Array.isArray(row.params?.selected_indexes) ? row.params?.selected_indexes : [],
      selected_candidate_ids: Array.isArray(row.params?.selected_candidate_ids) ? row.params?.selected_candidate_ids : [],
      source: row.params?.source || null,
      reason_chip: row.reason_chip || null,
    }));

    return NextResponse.json({ ok: true, batch_id: batchId || null, selections }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      selections: [],
      error: "voice-review GET crash: " + String((e as Error)?.message || e).slice(0, 160),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    const body = await req.json().catch(() => ({}));
    const batchId = text(body.batch_id, 80);
    const selectedIndexes = indexes(body.selected_indexes ?? body.indexes ?? body.choice);
    const selectedCandidateIds = ids(body.selected_candidate_ids ?? body.candidate_ids);
    if (!batchId) return NextResponse.json({ ok: false, error: "нужен batch_id" }, { status: 400 });
    if (!selectedIndexes.length && !selectedCandidateIds.length) return NextResponse.json({ ok: false, error: "нужен selected_indexes или selected_candidate_ids" }, { status: 400 });

    const reason = selectedCandidateIds.join(", ").slice(0, 80) || selectedIndexes.join(", ");
    const { error } = await db.from("cf_signals").insert({
      event: "voice_review_selected",
      reason_chip: reason,
      params: {
        source: text(body.source, 80) || "manual_voice_review_api",
        batch_id: batchId,
        selected_indexes: selectedIndexes,
        selected_candidate_ids: selectedCandidateIds,
        note: text(body.note, 220) || null,
      },
    });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      batch_id: batchId,
      selected_indexes: selectedIndexes,
      selected_candidate_ids: selectedCandidateIds,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "voice-review POST crash: " + String((e as Error)?.message || e).slice(0, 160),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
