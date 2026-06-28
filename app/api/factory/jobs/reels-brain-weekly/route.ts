import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  buildAutomationPlan,
  parseAutomationNiches,
  parseAutomationPlatforms,
  summarizeLoopResult,
} from "@/lib/factory/reelsBrainAutomation";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { persistReelsBrainAutomationRun, summarizeReelsBrainAutomationRuns } from "@/lib/factory/reelsBrainAutomationRuns";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function parseBodyNiches(body: Record<string, unknown>): string[] {
  if (Array.isArray(body.niches)) {
    return parseAutomationNiches(body.niches.map((row) => String(row || "").trim()).filter(Boolean).join(","), 6);
  }
  return parseAutomationNiches(typeof body.niches === "string" ? body.niches : null, 6);
}

async function runWeekly(req: NextRequest, body: Record<string, unknown>) {
  const db = getSupabaseAdmin();
  if (!db) {
    return NextResponse.json({ ok: true, warning: "Supabase не настроен", runs: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  const origin = req.nextUrl.origin;
  const cookie = req.headers.get("cookie");
  const fanoutHeaders: HeadersInit = { "Content-Type": "application/json" };
  if (cookie) fanoutHeaders.cookie = cookie;

  const niches = (Array.isArray(body.niches) || typeof body.niches === "string" ? parseBodyNiches(body) : parseAutomationNiches(req.nextUrl.searchParams.get("niches"), 6))
    .slice(0, Math.max(1, Math.min(6, Number(body.max_niches || req.nextUrl.searchParams.get("max_niches") || 2))));
  const platforms = parseAutomationPlatforms(
    typeof body.platforms === "string"
      ? body.platforms
      : req.nextUrl.searchParams.get("platforms"),
  );
  const queryCount = Math.max(1, Math.min(6, Number(body.query_count || req.nextUrl.searchParams.get("query_count") || 4)));
  const sourceLimit = Math.max(1, Math.min(50, Number(body.source_limit || req.nextUrl.searchParams.get("source_limit") || 24)));
  const analyzeLimit = Math.max(0, Math.min(25, Number(body.analyze_limit || req.nextUrl.searchParams.get("analyze_limit") || 12)));
  const persistMemory = body.persist_memory !== false && req.nextUrl.searchParams.get("persist_memory") !== "false";

  const { data: playbooks } = await db
    .from("niche_playbooks")
    .select("niche,playbook,updated_at")
    .in("niche", niches)
    .order("updated_at", { ascending: false });
  const { data: corpusRows } = await db
    .from("viral_videos")
    .select("niche,platform")
    .in("niche", niches)
    .limit(20000);

  const playbookMap = new Map<string, unknown>();
  for (const row of (playbooks as { niche?: string; playbook?: unknown }[] | null) || []) {
    const niche = String(row.niche || "").trim();
    if (!niche || playbookMap.has(niche)) continue;
    playbookMap.set(niche, row.playbook);
  }
  const corpusMap = new Map<string, number>();
  for (const row of (corpusRows as { niche?: string; platform?: string }[] | null) || []) {
    const niche = String(row.niche || "").trim();
    const platform = String(row.platform || "").trim();
    if (!niche || !platform) continue;
    const key = `${niche}:${platform}`;
    corpusMap.set(key, (corpusMap.get(key) || 0) + 1);
  }

  const runs: unknown[] = [];

  for (const niche of niches) {
    const playbook = playbookMap.get(niche);
    const platformRuns: unknown[] = [];
    for (const platform of platforms) {
      const plan = buildAutomationPlan({
        mode: "weekly",
        playbook,
        niche,
        platform,
        query_count: queryCount,
        source_limit: sourceLimit,
        analyze_limit: analyzeLimit,
        current_videos: corpusMap.get(`${niche}:${platform}`) || 0,
      });

      const bakeOffResponse = await internalFetch(`${origin}/api/factory/reels-brain/bake-off`, {
        method: "POST",
        headers: fanoutHeaders,
        body: JSON.stringify({
          niche,
          queries: plan.queries,
          limit: plan.bake_off_limit,
          target_platform: platform,
          persist: false,
          persist_memory: persistMemory,
        }),
        signal: AbortSignal.timeout(95000),
      });
      const bakeOff = await bakeOffResponse.json().catch(() => ({}));

      const loopResponse = await internalFetch(`${origin}/api/factory/reels-brain/loop`, {
        method: "POST",
        headers: fanoutHeaders,
        body: JSON.stringify({
          niche,
          queries: plan.queries,
          source_limit: plan.source_limit,
          analyze_limit: plan.analyze_limit,
          target_platform: platform,
          auto_relearn: true,
          persist_patterns: true,
        }),
        signal: AbortSignal.timeout(115000),
      });
      const loopResult = await loopResponse.json().catch(() => ({}));

      platformRuns.push({
        platform,
        plan,
        bake_off: {
          ok: bakeOffResponse.ok,
          best_provider: (bakeOff as { best_provider_by_platform?: Record<string, { provider?: string }> }).best_provider_by_platform?.[platform]?.provider || null,
          stable_provider: (bakeOff as { stable_best_provider_by_platform?: Record<string, { provider?: string }> }).stable_best_provider_by_platform?.[platform]?.provider || null,
          source_memory_updated: (bakeOff as { source_memory_updated?: boolean }).source_memory_updated === true,
          error: (bakeOff as { error?: string }).error || null,
        },
        loop: {
          ok: loopResponse.ok,
          metrics: summarizeLoopResult(loopResult),
          log: Array.isArray((loopResult as { log?: unknown[] }).log) ? ((loopResult as { log?: string[] }).log || []).slice(-8) : [],
          error: (loopResult as { error?: string }).error || null,
        },
      });
    }

    const digest = await internalFetch(`${origin}/api/factory/reels-brain/digest?niche=${encodeURIComponent(niche)}`, {
      headers: fanoutHeaders,
      signal: AbortSignal.timeout(25000),
    }).then((r) => r.json()).catch((e) => ({ error: String(e).slice(0, 120) }));

    runs.push({
      niche,
      platforms: platformRuns,
      digest: (digest as { digest?: unknown }).digest || null,
      digest_error: (digest as { error?: string }).error || null,
    });
  }

  const automationMemory = [];
  for (const run of runs as { niche?: string; platforms?: unknown[] }[]) {
    const runNiche = String(run.niche || "").trim();
    if (!runNiche) continue;
    const summary = summarizeReelsBrainAutomationRuns({
      mode: "weekly",
      niche: runNiche,
      platforms: platforms.filter((platform) => platform !== "unknown"),
      runs: run.platforms as Parameters<typeof summarizeReelsBrainAutomationRuns>[0]["runs"],
      ok: true,
    });
    automationMemory.push(await persistReelsBrainAutomationRun({ db, niches: [runNiche], summary }));
  }

  return NextResponse.json({
    ok: true,
    mode: "weekly",
    niches,
    platforms,
    query_count: queryCount,
    source_limit: sourceLimit,
    analyze_limit: analyzeLimit,
    persist_memory: persistMemory,
    runs,
    automation_memory: automationMemory,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return runWeekly(req, {});
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return runWeekly(req, body);
}
