import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Label = "winner" | "usable" | "trash";
type Row = {
  id: number;
  name?: string | null;
  kind?: string | null;
  url?: string | null;
  niche?: string | null;
  article?: string | null;
  analysis?: Record<string, unknown> | null;
  is_winner?: boolean | null;
  winner_at?: string | null;
  created_at?: string | null;
};

function text(value: unknown, max = 160): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isVideoUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) && /\.(mp4|mov|webm)(\?|$)/i.test(url);
}

function statusFromAnalysis(analysis: Record<string, unknown>): string {
  return text(analysis.status || analysis.result_status || analysis.source_status || analysis.verdict, 60).toLowerCase();
}

function viewsFromAnalysis(analysis: Record<string, unknown>): number | null {
  return num(analysis.views ?? analysis.market_views ?? analysis.winner_views);
}

function classify(row: Row): {
  label: Label;
  score: number;
  confidence: "high" | "medium" | "low";
  reasons: string[];
} {
  const analysis = row.analysis || {};
  const reasons: string[] = [];
  const url = text(row.url, 500);
  const kind = text(row.kind, 40).toLowerCase();
  const status = statusFromAnalysis(analysis);
  const otk = num(analysis.otk ?? analysis.otk_score);
  const views = viewsFromAnalysis(analysis);
  const source = text(analysis.source, 60).toLowerCase();

  if (!url || !isVideoUrl(url) || (kind && kind !== "video")) {
    return { label: "trash", score: 0, confidence: "high", reasons: ["not a playable video memory row"] };
  }
  if (status === "rejected" || status === "artifact_fail" || status === "run_fail") {
    return { label: "trash", score: 5, confidence: "high", reasons: [`bad status: ${status}`] };
  }
  if (otk != null && otk < 6) {
    return { label: "trash", score: Math.round(otk * 10), confidence: "high", reasons: [`OTK below usable threshold: ${otk}`] };
  }
  if (row.is_winner || row.winner_at) {
    return { label: "winner", score: 100, confidence: "high", reasons: ["explicit market/operator winner"] };
  }
  if (views != null && views >= 2500) {
    return { label: "winner", score: 92, confidence: "high", reasons: [`market views >= 2500: ${views}`] };
  }
  if (otk != null && otk >= 8) {
    return { label: "winner", score: Math.min(90, Math.round(otk * 10)), confidence: "medium", reasons: [`strong internal OTK: ${otk}`] };
  }
  if (otk != null && otk >= 6) {
    return { label: "usable", score: Math.round(otk * 10), confidence: "medium", reasons: [`usable internal OTK: ${otk}`] };
  }
  if (views != null && views >= 500) {
    return { label: "usable", score: 68, confidence: "medium", reasons: [`some market signal: ${views} views`] };
  }
  if (source === "storage_reconcile") {
    return { label: "usable", score: 50, confidence: "low", reasons: ["restored from storage; needs human/OTK review before becoming winner"] };
  }
  return { label: "usable", score: 55, confidence: "low", reasons: ["playable video but no quality signal yet"] };
}

async function loadRows(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < 10000; from += 1000) {
    const { data, error } = await db
      .from("content_assets")
      .select("id,name,kind,url,niche,article,analysis,is_winner,winner_at,created_at")
      .eq("disk", "gen")
      .eq("kind", "video")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data || []) as Row[]));
    if ((data || []).length < 1000) break;
  }
  return out;
}

function summarize(items: Array<{ label: Label; confidence: string }>) {
  const by_label = { winner: 0, usable: 0, trash: 0 };
  const by_confidence: Record<string, number> = {};
  for (const item of items) {
    by_label[item.label] += 1;
    by_confidence[item.confidence] = (by_confidence[item.confidence] || 0) + 1;
  }
  return { by_label, by_confidence };
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return run(false);
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  return run(body.apply === true);
}

async function run(apply: boolean) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });

    const rows = await loadRows(db);
    const classified = rows.map((row) => {
      const c = classify(row);
      return {
        id: row.id,
        name: row.name || "",
        url: row.url || "",
        niche: row.niche || null,
        article: row.article || null,
        previous_label: text(row.analysis?.memory_label, 20) || null,
        ...c,
      };
    });
    const changed = classified.filter((row) => row.previous_label !== row.label);
    const errors: string[] = [];
    let updated = 0;

    if (apply) {
      for (const item of changed) {
        const original = rows.find((row) => row.id === item.id);
        const nextAnalysis = {
          ...(original?.analysis || {}),
          memory_label: item.label,
          memory_score: item.score,
          memory_confidence: item.confidence,
          memory_reasons: item.reasons,
          memory_reviewed_at: new Date().toISOString(),
          memory_review_source: "memory_quality_auto_v1",
        };
        const { error } = await db.from("content_assets").update({ analysis: nextAnalysis }).eq("id", item.id);
        if (error) errors.push(error.message.slice(0, 180));
        else updated += 1;
        if (errors.length >= 20) break;
      }
    }

    const summary = summarize(classified);
    return NextResponse.json({
      ok: errors.length === 0,
      apply,
      total: classified.length,
      scanned: classified.length,
      changed: changed.length,
      updated,
      ...summary,
      summary,
      errors,
      sample_trash: classified.filter((row) => row.label === "trash").slice(0, 12),
      sample_winner: classified.filter((row) => row.label === "winner").slice(0, 12),
      sample_low_confidence: classified.filter((row) => row.confidence === "low").slice(0, 12),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      apply,
      total: 0,
      scanned: 0,
      changed: 0,
      updated: 0,
      by_label: { winner: 0, usable: 0, trash: 0 },
      by_confidence: {},
      summary: { by_label: { winner: 0, usable: 0, trash: 0 }, by_confidence: {} },
      errors: [`memory-quality crash: ${String((e as Error)?.message || e).slice(0, 180)}`],
      sample_trash: [],
      sample_winner: [],
      sample_low_confidence: [],
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
