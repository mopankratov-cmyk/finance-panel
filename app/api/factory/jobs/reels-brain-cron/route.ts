import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DEFAULT_NICHES = "ru_toys,ru_clothing,ru_cosmetics";
const DEFAULT_PLATFORMS = "tiktok,instagram,youtube";
const DEFAULT_TARGET_TOTAL = 6000;
const DEFAULT_MAX_BACKLOG_BEFORE_ANALYZE = 60;

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

function summarizeBacklogPlan(plan: unknown) {
  const lanes = Array.isArray((plan as { lanes?: unknown[] })?.lanes)
    ? ((plan as { lanes: unknown[] }).lanes as Array<Record<string, unknown>>)
    : [];
  return lanes.reduce<{ total: number; analyzed: number; unanalyzed: number }>((acc, lane) => {
    acc.total += Number(lane.total || 0);
    acc.analyzed += Number(lane.analyzed || 0);
    acc.unanalyzed += Number(lane.unanalyzed || 0);
    return acc;
  }, { total: 0, analyzed: 0, unanalyzed: 0 });
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

  const params = new URLSearchParams({
    niches,
    platforms,
    max_lanes: "9",
    limit: "18",
  });
  const response = await internalFetch(`${req.nextUrl.origin}/api/factory/jobs/reels-brain-analyze-backlog?${params}`, {
    method: "GET",
    signal: AbortSignal.timeout(30000),
  });
  const plan = await response.json().catch(() => ({}));
  const backlog = summarizeBacklogPlan(plan);
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

export async function GET(req: NextRequest) {
  try {
    if (!(await isAuthorizedReelsBrainJobRequest(req))) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const niches = req.nextUrl.searchParams.get("niches") || DEFAULT_NICHES;
    const platforms = req.nextUrl.searchParams.get("platforms") || DEFAULT_PLATFORMS;
    const auto = await selectAutoTask(req, niches, platforms);
    const task = auto.task;
    const endpoint = task === "bulk"
      ? "/api/factory/jobs/reels-brain-learning"
      : "/api/factory/jobs/reels-brain-analyze-backlog";
    const body = task === "bulk"
      ? {
        niches,
        platforms,
        strategy: "bulk",
        max_lanes: 3,
        limit: 25,
        providers_per_lane: 2,
        provider_timeout_ms: 30000,
        max_provider_calls: 6,
        max_cost_units: 18,
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

    return NextResponse.json({
      ok: response.ok && (result as { ok?: boolean }).ok !== false,
      mode: "reels_brain_cron",
      task,
      cadence: "*/5 * * * *",
      policy: "auto until target: bulk while corpus is below target and backlog is small, otherwise analyze",
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
