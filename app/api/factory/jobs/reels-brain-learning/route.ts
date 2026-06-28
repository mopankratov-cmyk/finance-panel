import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";
import { parseAutomationNiches, parseAutomationPlatforms } from "@/lib/factory/reelsBrainAutomation";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function scheduleProfile(hours: number) {
  if (hours >= 72) return { next_run_after_minutes: 15, target_ticks: Math.ceil((hours * 60) / 15) };
  if (hours >= 24) return { next_run_after_minutes: 12, target_ticks: Math.ceil((hours * 60) / 12) };
  return { next_run_after_minutes: 10, target_ticks: Math.ceil((hours * 60) / 10) };
}

function learningStrategy(body: Record<string, unknown>, req: NextRequest): "bulk" | "analyze" | "instagram" | "instagram_ru" {
  const raw = String(body.strategy || req.nextUrl.searchParams.get("strategy") || "bulk").trim().toLowerCase();
  if (raw === "instagram_ru" || raw === "ig_ru" || raw === "ru_instagram") return "instagram_ru";
  if (raw === "instagram" || raw === "ig") return "instagram";
  return raw === "analyze" || raw === "growth" ? "analyze" : "bulk";
}

function russianSegmentNiches(niches: string[], explicit: boolean): string[] {
  const rows = explicit ? niches : ["toys", "clothing", "cosmetics"];
  const mapped = rows
    .filter((niche) => niche !== "default" && niche !== "ru_default")
    .map((niche) => niche.startsWith("ru_") ? niche : `ru_${niche}`);
  return Array.from(new Set(mapped));
}

async function runLearningTick(req: NextRequest, body: Record<string, unknown>, execute: boolean) {
  const origin = req.nextUrl.origin;
  const cookie = req.headers.get("cookie");
  const fanoutHeaders: HeadersInit = { "Content-Type": "application/json" };
  if (cookie) fanoutHeaders.cookie = cookie;

  const explicitNiches = typeof body.niches === "string" || !!req.nextUrl.searchParams.get("niches");
  const parsedNiches = parseAutomationNiches(
    typeof body.niches === "string" ? body.niches : req.nextUrl.searchParams.get("niches"),
    10,
  );
  const platforms = parseAutomationPlatforms(
    typeof body.platforms === "string" ? body.platforms : req.nextUrl.searchParams.get("platforms"),
  ).filter((platform) => platform !== "unknown");
  const hours = Math.max(1, Math.min(168, Number(body.hours || req.nextUrl.searchParams.get("hours") || 72)));
  const schedule = scheduleProfile(hours);
  const strategy = learningStrategy(body, req);
  const niches = strategy === "instagram_ru" ? russianSegmentNiches(parsedNiches, explicitNiches) : parsedNiches;
  const endpoint = strategy === "analyze"
    ? "/api/factory/jobs/reels-brain-growth"
    : "/api/factory/jobs/reels-brain-bulk-ingest";
  const isInstagramCatchUp = strategy === "instagram" || strategy === "instagram_ru";
  const effectivePlatforms = isInstagramCatchUp ? ["instagram"] : platforms;
  const effectiveMaxLanes = isInstagramCatchUp ? 4 : Number(body.max_lanes || 3);
  const effectiveProvidersPerLane = isInstagramCatchUp ? 1 : Number(body.providers_per_lane || 2);
  const effectiveLimit = isInstagramCatchUp ? 25 : Number(body.limit || 25);
  const effectiveProviderTimeoutMs = isInstagramCatchUp ? 30000 : Number(body.provider_timeout_ms || 30000);
  const nicheParam = niches.join(",");
  const tickBody = strategy === "bulk"
    ? {
      dry_run: !execute,
      niches: nicheParam,
      platforms: effectivePlatforms.join(","),
      max_lanes: effectiveMaxLanes,
      limit: effectiveLimit,
      providers_per_lane: effectiveProvidersPerLane,
      provider_timeout_ms: effectiveProviderTimeoutMs,
    }
    : isInstagramCatchUp
    ? {
      dry_run: !execute,
      niches: nicheParam,
      platforms: effectivePlatforms.join(","),
      providers: ["apify_instagram"],
      max_lanes: effectiveMaxLanes,
      limit: effectiveLimit,
      providers_per_lane: effectiveProvidersPerLane,
      provider_timeout_ms: effectiveProviderTimeoutMs,
    }
    : {
      niches: nicheParam,
      platforms: effectivePlatforms.join(","),
      max_lanes: 2,
      query_count: 1,
      source_limit: 10,
      analyze_limit: 2,
    };

  const response = await internalFetch(`${origin}${endpoint}`, {
    method: strategy === "analyze" && !execute ? "GET" : "POST",
    headers: fanoutHeaders,
    body: strategy === "analyze" && !execute ? undefined : JSON.stringify(tickBody),
    signal: AbortSignal.timeout(115000),
  });
  const tick = await response.json().catch(() => ({}));

  return NextResponse.json({
    ok: response.ok && (tick as { ok?: boolean }).ok !== false,
    mode: "background_learning",
    strategy,
    execute,
    hours,
    schedule,
    niches,
    platforms: effectivePlatforms,
    tick,
    next_action: execute
      ? `Run this endpoint again in ${schedule.next_run_after_minutes} minutes until corpus target is reached.`
      : "POST this endpoint to execute one learning tick.",
  }, { status: response.ok ? 200 : 500, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return runLearningTick(req, {}, false);
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return runLearningTick(req, body, true);
}
