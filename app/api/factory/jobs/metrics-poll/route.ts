import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { internalFetch } from "@/lib/internalFetch";
import { metricsPostBody, summarizeMetricsPoll, type MetricsPollSource } from "@/lib/factory/metricsPoll";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authOk(req: NextRequest, body?: Record<string, unknown>): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return true;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return String(body?.secret || "") === secret;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function metricLikeFromPlan(id: number, plan: unknown): MetricsPollSource[] {
  const rec = asRecord(plan);
  if (!rec) return [];
  const nested = asRecord(rec.publication);
  const candidates = [
    rec.market_metrics,
    rec.publication_metrics,
    rec.post_metrics,
    rec.metrics,
    nested?.metrics,
  ];
  return candidates
    .map((candidate) => asRecord(candidate))
    .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate))
    .map((candidate) => ({
      recipe_id: id,
      target_platform: rec.target_platform,
      source: "run_plan",
      ...candidate,
    }));
}

function bodySources(body: Record<string, unknown>): MetricsPollSource[] {
  const raw = Array.isArray(body.items)
    ? body.items
    : Array.isArray(body.metrics)
      ? body.metrics
      : Array.isArray(body.snapshots)
        ? body.snapshots
        : [];
  if (raw.length) return raw as MetricsPollSource[];
  if (body.recipe_id || body.recipeId) return [body as MetricsPollSource];
  return [];
}

async function loadRunPlanMetrics(limit: number): Promise<{ sources: MetricsPollSource[]; warnings: string[] }> {
  const warnings: string[] = [];
  const db = getSupabaseAdmin();
  if (!db) return { sources: [], warnings: ["Supabase is not configured"] };
  try {
    const { data, error } = await db
      .from("node_recipes")
      .select("id,run_plan,output_url,status,updated_at")
      .not("output_url", "is", null)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) return { sources: [], warnings: ["node_recipes lookup: " + error.message.slice(0, 160)] };
    const rows = (data || []) as Array<{ id: number; run_plan?: unknown }>;
    return { sources: rows.flatMap((row) => metricLikeFromPlan(Number(row.id), row.run_plan)), warnings };
  } catch (e) {
    return { sources: [], warnings: ["node_recipes lookup exception: " + String((e as Error)?.message || e).slice(0, 160)] };
  }
}

async function handle(req: NextRequest, body: Record<string, unknown>) {
  if (!authOk(req, body)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const limit = Math.max(1, Math.min(100, Number(body.limit || req.nextUrl.searchParams.get("limit") || 30) || 30));
  let sources = bodySources(body);
  const warnings: string[] = [];
  if (!sources.length) {
    const loaded = await loadRunPlanMetrics(limit);
    sources = loaded.sources;
    warnings.push(...loaded.warnings);
  }

  const summary = summarizeMetricsPoll(sources);
  const posted: Array<{ recipe_id: number; ok: boolean; forwarded?: boolean; metrics_saved?: boolean; warnings?: unknown; error?: string }> = [];
  for (const snapshot of summary.ready.slice(0, limit)) {
    try {
      const res = await internalFetch(`${req.nextUrl.origin}/api/factory/post-metrics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metricsPostBody(snapshot)),
        signal: AbortSignal.timeout(20000),
      });
      const payload = await res.json().catch(() => ({})) as Record<string, unknown>;
      posted.push({
        recipe_id: snapshot.recipe_id,
        ok: res.ok && payload.ok !== false,
        forwarded: Boolean(payload.forwarded),
        metrics_saved: Boolean(payload.metrics_saved),
        warnings: payload.warnings,
        error: res.ok ? undefined : String(payload.error || res.statusText || res.status).slice(0, 160),
      });
    } catch (e) {
      posted.push({ recipe_id: snapshot.recipe_id, ok: false, error: String((e as Error)?.message || e).slice(0, 160) });
    }
  }

  return NextResponse.json({
    ok: true,
    mode: "metrics_poll_v1",
    total_sources: summary.total,
    normalized: summary.ready.length,
    posted: posted.filter((row) => row.ok).length,
    failed: posted.filter((row) => !row.ok).length,
    skipped: summary.skipped,
    post_results: posted,
    warnings: [...warnings, ...summary.warnings],
    note: summary.ready.length ? "metrics forwarded to post-metrics" : "no metrics available; batch remains fail-open",
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  return handle(req, {});
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  return handle(req, body);
}
