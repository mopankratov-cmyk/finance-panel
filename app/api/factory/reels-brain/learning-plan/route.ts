import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";
import {
  REELS_BRAIN_CORPUS_TARGET_TOTAL,
  corpusExecutionPlan,
  corpusProgress,
  corpusStage,
  corpusTargetByNiche,
  corpusTargetByPlatform,
} from "@/lib/factory/reelsBrainCorpusTargets";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

type JsonRecord = Record<string, any>;

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function splitList(value: unknown, fallback: string[]) {
  const rows = String(value || "")
    .split(",")
    .map((row) => row.trim())
    .filter(Boolean);
  return Array.from(new Set(rows.length ? rows : fallback)).slice(0, 20);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function firstPositive(...values: unknown[]): number {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

async function readInternal(req: NextRequest, path: string, params: Record<string, string>) {
  const url = new URL(path, req.nextUrl.origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await internalFetch(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || body?.warning || response.statusText);
  return body as JsonRecord;
}

function rowMap(source: unknown, key: string) {
  const rows = source && typeof source === "object" ? source as Record<string, JsonRecord> : {};
  return Object.entries(rows).map(([id, row]) => ({ [key]: id, ...row }));
}

function learningVelocity(timeline: JsonRecord[]) {
  const recent = timeline.slice(-8);
  const inserted = recent.reduce((sum, row) => sum + num(row.inserted), 0);
  const analyzed = recent.reduce((sum, row) => sum + num(row.analyzed), 0);
  const runs = Math.max(1, recent.length);
  return {
    sample_runs: recent.length,
    inserted_per_tick: Math.round(inserted / runs),
    analyzed_per_tick: Math.round(analyzed / runs),
  };
}

function nextTick(input: {
  target: number;
  totalVideos: number;
  analyzedVideos: number;
  backlogLimit: number;
  canRunPaidCollection: boolean;
  guardStatus?: string;
}) {
  const backlog = Math.max(0, input.totalVideos - input.analyzedVideos);
  if (backlog >= input.backlogLimit) {
    return {
      task: "analyze_backlog",
      label: "Сначала разобрать накопленный backlog",
      reason: `В базе есть ${backlog} неразобранных видео. Дешевле превратить их в память, чем покупать новый сбор.`,
      endpoint: "/api/factory/jobs/reels-brain-learning",
      params: { strategy: "analyze", limit: "80" },
      paid_collection: false,
    };
  }

  if (!input.canRunPaidCollection) {
    return {
      task: "wait_or_repair_sources",
      label: "Платный сбор временно не трогать",
      reason: `Cost guard сейчас ${input.guardStatus || "watch"}: лучше чинить источники/анализ, а не жечь бюджет.`,
      endpoint: "/api/factory/reels-brain/autopilot-actions",
      params: { mode: "read_only" },
      paid_collection: false,
    };
  }

  if (input.totalVideos < input.target) {
    return {
      task: "collect_smart_batch",
      label: "Добрать новую умную пачку",
      reason: "Backlog под контролем, budget guard разрешает сбор, цель корпуса ещё не закрыта.",
      endpoint: "/api/factory/jobs/reels-brain-cron",
      params: { task: "bulk", target: String(input.target), max_backlog_before_analyze: String(input.backlogLimit) },
      paid_collection: true,
    };
  }

  return {
    task: "build_patterns",
    label: "Пересобрать Pattern Brain",
    reason: "Цель корпуса закрыта: следующий шаг — сжать данные в паттерны и creative briefs.",
    endpoint: "/api/factory/jobs/reels-brain-learning",
    params: { strategy: "analyze", build_patterns: "true" },
    paid_collection: false,
  };
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const target = clamp(num(sp.get("target")) || REELS_BRAIN_CORPUS_TARGET_TOTAL, 300, 250_000);
    const backlogLimit = clamp(num(sp.get("max_backlog_before_analyze")) || 180, 20, 2_000);
    const niches = splitList(sp.get("niches"), ["ru_toys", "ru_clothing", "ru_cosmetics"]);
    const platforms = splitList(sp.get("platforms"), ["tiktok", "instagram", "youtube"]);

    const [learning, corpus, autopilot] = await Promise.all([
      readInternal(req, "/api/factory/reels-brain/learning-economics", { niches: niches.join(","), limit: sp.get("limit") || "80" }),
      readInternal(req, "/api/factory/reels-brain/corpus", { limit: "200", min_score: "0" }),
      readInternal(req, "/api/factory/reels-brain/autopilot-actions", { niches: niches.join(","), limit: sp.get("limit") || "80" }),
    ]);

    const totals = learning.totals || {};
    const audit = learning.corpus_audit || {};
    const totalVideos = Math.max(num(totals.total_videos), num(corpus.total), num(audit.sampled_rows));
    const analyzedVideos = Math.max(num(totals.analyzed_videos), num(corpus.summary?.analyzed));
    const backlog = Math.max(0, totalVideos - analyzedVideos);
    const progress = corpusProgress({ current: totalVideos, target });
    const stage = corpusStage(totalVideos);
    const platformTargets = corpusTargetByPlatform(target);
    const nicheTargets = corpusTargetByNiche(niches, target);
    const platformRows = rowMap(audit.by_platform, "platform")
      .filter((row) => platforms.includes(String(row.platform)))
      .map((row) => ({
        platform: row.platform as "tiktok" | "instagram" | "youtube",
        current: num(row.total),
        target: num(platformTargets[row.platform as keyof typeof platformTargets]),
      }));
    const nicheRows = rowMap(audit.by_niche, "niche")
      .filter((row) => niches.includes(String(row.niche)))
      .map((row) => ({ niche: String(row.niche), current: num(row.total), target: num(nicheTargets[String(row.niche)]) }));
    const executionPlan = corpusExecutionPlan({
      currentTotal: totalVideos,
      targetTotal: target,
      niches: nicheRows.length ? nicheRows : niches.map((niche) => ({ niche, current: 0, target: num(nicheTargets[niche]) })),
      platforms: platformRows.length ? platformRows : (Object.entries(platformTargets) as Array<["tiktok" | "instagram" | "youtube", number]>)
        .filter(([platform]) => platforms.includes(platform))
        .map(([platform, platformTarget]) => ({ platform, current: 0, target: platformTarget })),
      horizonDays: num(sp.get("horizon_days")) || 30,
    });

    const costGovernor = autopilot.cost_governor || learning.cost_governor || {};
    const autopilotActions = autopilot.autopilot_actions || learning.autopilot_actions || {};
    const canRunPaidCollection = Boolean(autopilotActions.can_run_paid_collection ?? true)
      && !["pause_or_review", "paused", "blocked"].includes(String(costGovernor.status || ""));
    const velocity = learningVelocity((learning.timeline || []) as JsonRecord[]);
    const relevantSpeed = firstPositive(velocity.inserted_per_tick, velocity.analyzed_per_tick, 25);
    const etaTicksToTarget = progress.gap > 0 ? Math.ceil(progress.gap / Math.max(1, relevantSpeed)) : 0;
    const etaTicksToAnalyzed = backlog > 0 ? Math.ceil(backlog / Math.max(1, firstPositive(velocity.analyzed_per_tick, 40))) : 0;

    return NextResponse.json({
      ok: true,
      learning_plan: {
        mission: "standalone_reels_brain_training",
        target_videos: target,
        niches,
        platforms,
        progress,
        stage,
        backlog: {
          total: backlog,
          limit_before_paid_collection: backlogLimit,
          status: backlog >= backlogLimit ? "analyze_first" : "healthy",
        },
        next_tick: nextTick({
          target,
          totalVideos,
          analyzedVideos,
          backlogLimit,
          canRunPaidCollection,
          guardStatus: String(costGovernor.status || ""),
        }),
        execution_plan: executionPlan,
        eta: {
          ticks_to_target: etaTicksToTarget,
          ticks_to_clear_backlog: etaTicksToAnalyzed,
          inserted_per_tick: velocity.inserted_per_tick,
          analyzed_per_tick: velocity.analyzed_per_tick,
          sample_runs: velocity.sample_runs,
        },
        guard: {
          can_run_paid_collection: canRunPaidCollection,
          status: costGovernor.status || "watch",
          today_spend_usd: num(costGovernor.today_spend_usd),
          max_daily_spend_usd: num(costGovernor.max_daily_spend_usd),
          current_useful_video_usd: num(costGovernor.current_useful_video_usd),
          max_useful_video_usd: num(costGovernor.max_useful_video_usd),
        },
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "learning-plan reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
