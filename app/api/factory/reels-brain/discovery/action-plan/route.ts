import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  buildDiscoveryPlan,
  buildDiscoveryReplay,
  discoverySources,
  rememberDiscoverySourceRun,
  type ReelsDiscoveryReplayRow,
  type ReelsDiscoverySource,
  type ReelsDiscoverySourceType,
} from "@/lib/factory/reelsBrainDiscovery";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_NICHES = "ru_toys,ru_clothing,ru_cosmetics";
const DEFAULT_PLATFORMS = "tiktok,instagram,youtube";

function splitList(value: unknown): string[] {
  return Array.from(new Set(String(value || "")
    .split(",")
    .map((row) => row.trim())
    .filter(Boolean)))
    .slice(0, 20);
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function recommendation(source: ReelsDiscoverySource) {
  if (source.status !== "active") return "skip" as const;
  if (source.runs < 2) return "explore_more" as const;
  if (source.yield_score >= 65 && source.cost_per_relevant <= 2.5) return "scale" as const;
  if (source.yield_score >= 45) return "refresh" as const;
  return "avoid" as const;
}

async function loadPlaybooks(niches: string[]) {
  const db = getSupabaseAdmin();
  if (!db) return { rows: [], error: "Supabase не настроен" };
  const { data, error } = await db
    .from("niche_playbooks")
    .select("niche,playbook,updated_at")
    .in("niche", niches);
  if (error) return { rows: [], error: error.message };
  return { rows: (data || []) as { niche?: string; playbook?: Record<string, unknown>; updated_at?: string }[], error: null };
}

async function loadCorpusRows(input: { niche: string; platform: string; limit: number }) {
  const db = getSupabaseAdmin();
  if (!db) return { rows: [], error: "Supabase не настроен" };
  const { data, error } = await db
    .from("viral_videos")
    .select("url,platform,niche,caption,views,likes,followers_creator,virality_score,sound_id,sound_title,source_orbit_id")
    .eq("niche", input.niche)
    .eq("platform", input.platform)
    .order("virality_score", { ascending: false, nullsFirst: false })
    .limit(input.limit);
  if (error) return { rows: [], error: error.message };
  return { rows: (data || []) as ReelsDiscoveryReplayRow[], error: null };
}

async function persistPlaybook(niche: string, playbook: Record<string, unknown>) {
  const db = getSupabaseAdmin();
  if (!db) return "Supabase не настроен";
  const { error } = await db.from("niche_playbooks").upsert({
    niche,
    playbook: { ...playbook, niche },
    updated_at: new Date().toISOString(),
  }, { onConflict: "niche" });
  return error?.message || null;
}

async function buildActionPlan(req: NextRequest, body: Record<string, unknown>) {
  const sp = req.nextUrl.searchParams;
  const niches = splitList(body.niches || sp.get("niches") || DEFAULT_NICHES);
  const platforms = splitList(body.platforms || sp.get("platforms") || DEFAULT_PLATFORMS)
    .filter((platform) => ["tiktok", "instagram", "youtube"].includes(platform));
  const replay = body.replay === true || sp.get("replay") === "true";
  const persistReplay = body.persist_replay === true || sp.get("persist_replay") === "true";
  const replayLimit = Math.max(50, Math.min(5000, Number(body.replay_limit || sp.get("replay_limit") || 1500)));
  const maxItems = Math.max(1, Math.min(18, Number(body.max_items || sp.get("max_items") || 8)));
  const sourceLimit = Math.max(5, Math.min(100, Number(body.source_limit || sp.get("source_limit") || 35)));
  const { rows, error } = await loadPlaybooks(niches);
  if (error) return NextResponse.json({ error }, { status: 500 });

  const playbookByNiche = new Map<string, Record<string, unknown>>();
  for (const row of rows) playbookByNiche.set(row.niche || "default", row.playbook || { niche: row.niche });
  for (const niche of niches) {
    if (!playbookByNiche.has(niche)) playbookByNiche.set(niche, { niche });
  }

  const replayResults: unknown[] = [];
  const replayWarnings: string[] = [];
  if (replay) {
    for (const niche of niches) {
      for (const platform of platforms) {
        const loaded = await loadCorpusRows({ niche, platform, limit: replayLimit });
        if (loaded.error) {
          replayWarnings.push(`${niche}/${platform}: ${loaded.error}`);
          continue;
        }
        const replayResult = buildDiscoveryReplay({ niche, platform, rows: loaded.rows, min_candidate_score: 45 });
        let playbook = playbookByNiche.get(niche) || { niche };
        let persistedSources = 0;
        if (persistReplay) {
          for (const source of replayResult.sources.slice(0, 8)) {
            playbook = rememberDiscoverySourceRun(playbook, {
              niche,
              platform,
              type: source.type as ReelsDiscoverySourceType,
              value: source.value,
              found: source.found,
              relevant: source.relevant,
              breakout: source.breakout,
              inserted: source.inserted,
              cost_units: 1,
              reason: `action-plan replay from ${source.provider || "corpus"}`,
            });
            persistedSources += 1;
          }
          playbookByNiche.set(niche, playbook);
        }
        replayResults.push({
          niche,
          platform,
          scanned: replayResult.scanned,
          relevant: replayResult.relevant,
          breakout: replayResult.breakout,
          top_sources: replayResult.sources.slice(0, 5),
          persisted_sources: persistedSources,
        });
      }
      if (persistReplay) {
        const warning = await persistPlaybook(niche, playbookByNiche.get(niche) || { niche });
        if (warning) replayWarnings.push(`${niche}: ${warning}`);
      }
    }
  }

  const lanes = [];
  const allSources: Array<ReelsDiscoverySource & { recommendation: ReturnType<typeof recommendation> }> = [];
  for (const niche of niches) {
    const playbook = playbookByNiche.get(niche) || { niche };
    for (const platform of platforms) {
      const plan = buildDiscoveryPlan(playbook, { niche, platform, max_items: maxItems, source_limit: sourceLimit });
      lanes.push({
        niche,
        platform,
        budget_split: plan.budget_split,
        source_count: plan.source_count,
        active_source_count: plan.active_source_count,
        next_payloads: plan.items.map((item) => ({
          lane: item.lane,
          provider_hint: item.provider_hint || null,
          source: item.source,
          source_run_payload: item.source_run_payload,
        })),
        notes: plan.notes,
      });
      allSources.push(...discoverySources(playbook, { niche, platform, includePaused: true }).map((source) => ({
        ...source,
        recommendation: recommendation(source),
      })));
    }
  }

  const rankedSources = allSources.sort((a, b) =>
    b.yield_score - a.yield_score
    || a.cost_per_relevant - b.cost_per_relevant
    || b.relevant - a.relevant
  );
  const stopList = rankedSources
    .filter((source) => source.recommendation === "avoid")
    .map((source) => ({
      id: source.id,
      niche: source.niche,
      platform: source.platform,
      type: source.type,
      value: source.value,
      yield_score: source.yield_score,
      relevance_rate: source.relevance_rate,
      cost_per_relevant: source.cost_per_relevant,
      reason: source.reason || "Низкий yield или высокая цена за полезный референс.",
    }))
    .slice(0, 20);
  const scaleList = rankedSources
    .filter((source) => source.recommendation === "scale")
    .slice(0, 20);
  const exploreList = rankedSources
    .filter((source) => source.recommendation === "explore_more")
    .slice(0, 20);
  const nextPayloads = lanes.flatMap((lane) => lane.next_payloads)
    .slice(0, maxItems * Math.max(1, platforms.length));
  const estimatedUseful = rankedSources.reduce((sum, source) => sum + num(source.relevant), 0);
  const estimatedCostUnits = rankedSources.reduce((sum, source) => sum + Math.max(1, num(source.cost_per_relevant)) * Math.max(1, num(source.relevant)), 0);

  return NextResponse.json({
    ok: true,
    mode: "next_collection_plan",
    niches,
    platforms,
    replay: {
      enabled: replay,
      persisted: persistReplay,
      results: replayResults,
      warnings: replayWarnings,
    },
    summary: {
      lanes: lanes.length,
      known_sources: rankedSources.length,
      scale_sources: scaleList.length,
      explore_sources: exploreList.length,
      stop_sources: stopList.length,
      estimated_cost_units_per_useful: estimatedUseful ? Math.round((estimatedCostUnits / estimatedUseful) * 100) / 100 : null,
    },
    next_collection_plan: {
      instruction: "Следующий платный сбор начинать с scale_sources, затем малыми лимитами explore_sources. Stop-list не запускать без ручной причины.",
      payloads: nextPayloads,
      lanes,
    },
    scale_sources: scaleList,
    explore_sources: exploreList,
    stop_list: stopList,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  try {
    return buildActionPlan(req, {});
  } catch (e) {
    return NextResponse.json({ error: "discovery/action-plan reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    return buildActionPlan(req, body);
  } catch (e) {
    return NextResponse.json({ error: "discovery/action-plan reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}

