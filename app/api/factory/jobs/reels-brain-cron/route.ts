import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { REELS_BRAIN_CORPUS_TARGET_TOTAL } from "@/lib/factory/reelsBrainCorpusTargets";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DEFAULT_NICHES = "ru_toys,ru_clothing,ru_cosmetics";
const DEFAULT_PLATFORMS = "tiktok,instagram,youtube";
const DEFAULT_TARGET_TOTAL = REELS_BRAIN_CORPUS_TARGET_TOTAL;
const DEFAULT_MAX_BACKLOG_BEFORE_ANALYZE = 120;
const SUPABASE_PAGE_SIZE = 1000;
const MAX_BACKLOG_ROWS = 50000;

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstNonEmptyRecord(...values: unknown[]): Record<string, unknown> {
  for (const value of values) {
    const record = rec(value);
    if (Object.keys(record).length) return record;
  }
  return {};
}

function forcedTask(req: NextRequest): "bulk" | "analyze" | null {
  const raw = String(req.nextUrl.searchParams.get("task") || req.nextUrl.searchParams.get("mode") || "").trim().toLowerCase();
  if (raw === "bulk" || raw === "ingest") return "bulk";
  if (raw === "analyze" || raw === "analysis") return "analyze";
  return null;
}

function numberParam(req: NextRequest, name: string, fallback: number, min: number, max: number): number {
  const value = Number(req.nextUrl.searchParams.get(name) || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function splitParam(value: string): string[] {
  return value
    .split(",")
    .map((row) => row.trim())
    .filter(Boolean);
}

async function loadPipelineProgress(req: NextRequest, niches: string) {
  try {
    const url = new URL("/api/factory/reels-brain/progress", req.nextUrl.origin);
    url.searchParams.set("niches", niches);
    const response = await internalFetch(url);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, data: null as Record<string, unknown> | null, error: data?.error || response.statusText };
    return { ok: true, data: data as Record<string, unknown>, error: null as string | null };
  } catch (error) {
    return { ok: false, data: null as Record<string, unknown> | null, error: String((error as Error)?.message || error).slice(0, 160) };
  }
}

async function runPipelinePreflight(req: NextRequest, input: {
  niches: string;
  progress: { ok: boolean; data: Record<string, unknown> | null };
}) {
  const totals = rec(input.progress.data?.totals);
  const platforms = Array.isArray(input.progress.data?.platforms) ? input.progress.data?.platforms.map((row) => rec(row)) : [];
  const instagram = platforms.find((row) => String(row.platform || "") === "instagram") || {};
  const youtube = platforms.find((row) => String(row.platform || "") === "youtube") || {};
  const mediaTarget = Number(instagram.media_backlog || 0) > 0 ? "instagram" : Number(youtube.media_backlog || 0) > 0 ? "youtube" : "";
  const needsAudio = Number(totals.audio_backlog || 0) > 0 || Number(totals.transcript_backlog || 0) > 0;

  const result: Record<string, unknown> = {
    progress_totals: totals,
  };

  if (mediaTarget) {
    const mediaUrl = new URL("/api/factory/jobs/reels-brain-media-backfill", req.nextUrl.origin);
    mediaUrl.searchParams.set("niches", input.niches);
    mediaUrl.searchParams.set("platform", mediaTarget);
    mediaUrl.searchParams.set("limit", mediaTarget === "instagram" ? "2" : "1");
    mediaUrl.searchParams.set("scan", mediaTarget === "instagram" ? "24" : "12");
    mediaUrl.searchParams.set("use_local_resolver", "1");
    mediaUrl.searchParams.set("priority", "smart");
    const response = await internalFetch(mediaUrl);
    const body = await response.json().catch(() => ({}));
    result.media_tick = {
      ok: response.ok && body?.ok !== false,
      platform: mediaTarget,
      attempted: body?.attempted ?? null,
      rows_with_media: body?.rows_with_media ?? null,
      inserted: body?.inserted ?? null,
      enriched: body?.enriched ?? null,
      error: body?.error || null,
    };
  }

  if (needsAudio) {
    const audioUrl = new URL("/api/factory/jobs/reels-brain-audio-backfill", req.nextUrl.origin);
    audioUrl.searchParams.set("niches", input.niches);
    audioUrl.searchParams.set("limit", "3");
    audioUrl.searchParams.set("scan", "36");
    audioUrl.searchParams.set("transcribe", "1");
    audioUrl.searchParams.set("priority", "smart");
    audioUrl.searchParams.set("deep_only", "1");
    const response = await internalFetch(audioUrl);
    const body = await response.json().catch(() => ({}));
    result.audio_tick = {
      ok: response.ok && body?.ok !== false,
      extracted: body?.extracted ?? null,
      transcript_ready: body?.transcript_ready ?? null,
      failed: body?.failed ?? null,
      attempted: Array.isArray(body?.runs) ? body.runs.length : null,
      error: body?.error || null,
    };
  }

  return result;
}

async function loadBacklogTotals(input: { niches: string; platforms: string }) {
  const db = getSupabaseAdmin();
  if (!db) return { total: 0, analyzed: 0, unanalyzed: 0, error: "Supabase не настроен" };
  const niches = splitParam(input.niches);
  const platforms = new Set(splitParam(input.platforms));
  const summary = { total: 0, analyzed: 0, unanalyzed: 0 };

  for (let from = 0; from < MAX_BACKLOG_ROWS; from += SUPABASE_PAGE_SIZE) {
    const to = Math.min(from + SUPABASE_PAGE_SIZE - 1, MAX_BACKLOG_ROWS - 1);
    const { data, error } = await db
      .from("viral_videos")
      .select("niche,platform,analyzed")
      .in("niche", niches)
      .range(from, to);
    if (error) return { ...summary, error: error.message };
    const page = (data || []) as Array<{ niche?: string | null; platform?: string | null; analyzed?: boolean | null }>;
    for (const row of page) {
      const platform = String(row.platform || "").trim();
      if (!platforms.has(platform)) continue;
      summary.total += 1;
      if (row.analyzed === false) summary.unanalyzed += 1;
      else summary.analyzed += 1;
    }
    if (page.length < SUPABASE_PAGE_SIZE) break;
  }

  return summary;
}

async function selectAutoTask(req: NextRequest, niches: string, platforms: string) {
  const forced = forcedTask(req);
  const targetTotal = numberParam(req, "target", DEFAULT_TARGET_TOTAL, 1000, 10000);
  const maxBacklogBeforeAnalyze = numberParam(req, "max_backlog_before_analyze", DEFAULT_MAX_BACKLOG_BEFORE_ANALYZE, 1, 1000);

  if (forced) {
    return {
      task: forced,
      targetTotal,
      maxBacklogBeforeAnalyze,
      backlog: null,
      decision: `forced ${forced}`,
    };
  }

  const backlog = await loadBacklogTotals({ niches, platforms });
  const task = backlog.total >= targetTotal || backlog.unanalyzed > maxBacklogBeforeAnalyze ? "analyze" : "bulk";

  return {
    task,
    targetTotal,
    maxBacklogBeforeAnalyze,
    backlog,
    decision: task === "bulk"
      ? `corpus ${backlog.total}/${targetTotal}, backlog ${backlog.unanalyzed} <= ${maxBacklogBeforeAnalyze}: grow corpus`
      : `corpus ${backlog.total}/${targetTotal}, backlog ${backlog.unanalyzed}: analyze memory`,
  };
}

async function loadAutopilotGuard(req: NextRequest, niches: string) {
  try {
    const url = new URL("/api/factory/reels-brain/autopilot-actions", req.nextUrl.origin);
    url.searchParams.set("niches", niches);
    const response = await internalFetch(url);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, can_run_paid_collection: false, reason: data?.error || response.statusText, data };
    const canRun = data?.autopilot_actions?.can_run_paid_collection !== false
      && data?.cost_governor?.status !== "pause_or_review";
    return {
      ok: true,
      can_run_paid_collection: canRun,
      reason: canRun ? "autopilot_guard_ok" : "cost_governor_or_autopilot_paused",
      data,
    };
  } catch (error) {
    return {
      ok: false,
      can_run_paid_collection: true,
      reason: "autopilot_guard_error: " + String((error as Error)?.message || error).slice(0, 120),
      data: null,
    };
  }
}

export async function GET(req: NextRequest) {
  try {
    if (!(await isAuthorizedReelsBrainJobRequest(req))) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const niches = req.nextUrl.searchParams.get("niches") || DEFAULT_NICHES;
    const platforms = req.nextUrl.searchParams.get("platforms") || DEFAULT_PLATFORMS;
    const auto = await selectAutoTask(req, niches, platforms);
    const pipelineProgress = await loadPipelineProgress(req, niches);
    const preflight = pipelineProgress.ok ? await runPipelinePreflight(req, { niches, progress: pipelineProgress }) : null;
    const guard = auto.task === "bulk" ? await loadAutopilotGuard(req, niches) : null;
    const task = auto.task === "bulk" && guard?.ok && !guard.can_run_paid_collection ? "analyze" : auto.task;
    const endpoint = task === "bulk"
      ? "/api/factory/jobs/reels-brain-bulk-ingest"
      : "/api/factory/jobs/reels-brain-analyze-backlog";
    const body = task === "bulk"
      ? {
        niches,
        platforms,
        max_lanes: 6,
        limit: 50,
        providers_per_lane: 2,
        query_variants_per_lane: 3,
        provider_timeout_ms: 20000,
        max_provider_calls: 12,
        max_cost_units: 30,
        hours: 72,
      }
      : {
        niches,
        platforms,
        max_lanes: 6,
        limit: 18,
        build_patterns: false,
      };

    const response = await internalFetch(`${req.nextUrl.origin}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(115000),
    });
    const result = await response.json().catch(() => ({}));
    const resultRecord = rec(result);
    const nestedResultRecord = rec(resultRecord.result);
    const tickRecord = firstNonEmptyRecord(
      resultRecord.tick,
      nestedResultRecord.tick,
      nestedResultRecord,
      resultRecord,
    );
    const summaryRecord = firstNonEmptyRecord(
      tickRecord.automation_summary,
      nestedResultRecord.automation_summary,
      resultRecord.automation_summary,
    );
    console.info("reels_brain_cron_tick", JSON.stringify({
      task,
      decision: auto.decision,
      guard: guard ? { ok: guard.ok, can_run_paid_collection: guard.can_run_paid_collection, reason: guard.reason } : null,
      pipeline_progress_ok: pipelineProgress.ok,
      pipeline_preflight: preflight,
      target_total: auto.targetTotal,
      backlog: auto.backlog,
      endpoint,
      status: response.status,
      ok: response.ok && (result as { ok?: boolean }).ok !== false,
      found: tickRecord.found ?? summaryRecord.found ?? null,
      inserted: tickRecord.inserted ?? summaryRecord.inserted ?? null,
      enriched: tickRecord.enriched ?? summaryRecord.enriched ?? null,
      analyzed: tickRecord.analyzed ?? summaryRecord.analyzed ?? null,
      errors: tickRecord.errors ?? summaryRecord.errors ?? null,
      discovery_learning: Array.isArray(tickRecord.discovery_learning)
        ? tickRecord.discovery_learning.length
        : Array.isArray(nestedResultRecord.discovery_learning)
          ? nestedResultRecord.discovery_learning.length
        : Array.isArray(resultRecord.discovery_learning)
          ? resultRecord.discovery_learning.length
          : null,
    }));

    return NextResponse.json({
      ok: response.ok && (result as { ok?: boolean }).ok !== false,
      mode: "reels_brain_cron",
      task,
      cadence: "*/5 * * * *",
      policy: "auto until target: bulk while corpus is below target and backlog is small, otherwise analyze",
      guard: guard ? { ok: guard.ok, can_run_paid_collection: guard.can_run_paid_collection, reason: guard.reason } : null,
      pipeline_progress: pipelineProgress.ok ? pipelineProgress.data : null,
      pipeline_preflight: preflight,
      original_task: auto.task,
      target_total: auto.targetTotal,
      max_backlog_before_analyze: auto.maxBacklogBeforeAnalyze,
      backlog: auto.backlog,
      decision: auto.decision,
      endpoint,
      result,
    }, { status: response.ok ? 200 : 500, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "reels-brain-cron crash: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
