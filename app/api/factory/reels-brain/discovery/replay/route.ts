import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  buildDiscoveryReplay,
  rememberDiscoverySourceRun,
  type ReelsDiscoveryReplayRow,
  type ReelsDiscoverySourceType,
} from "@/lib/factory/reelsBrainDiscovery";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function loadCorpusRows(input: {
  niche: string;
  platform: string;
  limit: number;
}): Promise<{ rows: ReelsDiscoveryReplayRow[]; error?: string }> {
  const db = getSupabaseAdmin();
  if (!db) return { rows: [], error: "Supabase не настроен" };
  let query = db
    .from("viral_videos")
    .select("url,platform,niche,caption,views,likes,followers_creator,virality_score,sound_id,sound_title,source_orbit_id")
    .eq("niche", input.niche)
    .order("virality_score", { ascending: false, nullsFirst: false })
    .limit(input.limit);
  if (input.platform) query = query.eq("platform", input.platform);
  const { data, error } = await query;
  if (error) return { rows: [], error: error.message };
  return { rows: (data || []) as ReelsDiscoveryReplayRow[] };
}

async function loadPlaybook(niche: string): Promise<Record<string, unknown>> {
  const db = getSupabaseAdmin();
  if (!db) return { niche };
  const { data } = await db
    .from("niche_playbooks")
    .select("playbook")
    .eq("niche", niche)
    .order("updated_at", { ascending: false })
    .limit(1);
  return ((data as { playbook?: Record<string, unknown> }[] | null)?.[0]?.playbook || { niche }) as Record<string, unknown>;
}

export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
    const sp = req.nextUrl.searchParams;
    const niche = String(sp.get("niche") || "ru_cosmetics").trim() || "ru_cosmetics";
    const platform = String(sp.get("platform") || sp.get("target_platform") || "").trim().toLowerCase();
    const limit = Math.min(5000, Math.max(10, Number(sp.get("limit") || 3000)));
    const persist = sp.get("persist") === "true";
    const maxPersistParam = Number(sp.get("max_persist_sources") || 0);
    const maxPersistSources = Number.isFinite(maxPersistParam) && maxPersistParam > 0
      ? Math.floor(maxPersistParam)
      : null;
    const minCandidateScore = Math.min(100, Math.max(0, Number(sp.get("min_candidate_score") || 45)));
    const { rows, error } = await loadCorpusRows({ niche, platform, limit });
    if (error) return NextResponse.json({ error: "viral_videos: " + error }, { status: 500 });

    const replay = buildDiscoveryReplay({
      niche,
      platform: platform || rows.find((row) => row.platform)?.platform || "tiktok",
      rows,
      min_candidate_score: minCandidateScore,
    });

    let persisted = false;
    let persistedSources = 0;
    let warning: string | null = null;
    if (persist && replay.sources.length) {
      try {
        let playbook = await loadPlaybook(niche);
        const sourcesToPersist = maxPersistSources ? replay.sources.slice(0, maxPersistSources) : replay.sources;
        for (const source of sourcesToPersist) {
          playbook = rememberDiscoverySourceRun(playbook, {
            niche,
            platform: replay.platform,
            type: source.type as ReelsDiscoverySourceType,
            value: source.value,
            found: source.found,
            relevant: source.relevant,
            breakout: source.breakout,
            inserted: source.inserted,
            cost_units: 1,
            reason: `discovery replay from ${source.provider || "corpus"}`,
          });
          persistedSources += 1;
        }
        const { error: upErr } = await db.from("niche_playbooks").upsert({
          niche,
          playbook: { ...playbook, niche },
          updated_at: new Date().toISOString(),
        }, { onConflict: "niche" });
        if (upErr) warning = upErr.message;
        else persisted = true;
      } catch (e) {
        warning = String((e as Error)?.message || e).slice(0, 160);
      }
    }

    return NextResponse.json({
      ok: true,
      niche,
      platform: platform || null,
      limit,
      persist,
      persisted,
      persisted_sources: persistedSources,
      warning,
      replay: {
        ...replay,
        sources: replay.sources,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "discovery/replay reels-brain упал: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
