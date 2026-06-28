import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildReelsBrainPlatformSummary } from "@/lib/factory/reelsBrainSummary";
import {
  assessTrainingReadiness,
  automationRunHistory,
  corpusQualityGate,
  incidentHistory,
  normalizeShortPlatform,
  preferredSourceProviders,
  queryLeaderboard,
  recoverableSourceQueries,
  recommendSourceQueries,
  suppressedSourceQueries,
  sourceProviderHistory,
  sourceRelearnPolicy,
} from "@/lib/factory/reelsBrainPlaybook";
import type { ReelsPlatform } from "@/lib/factory/reelsBrain";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

function patternCountsFromPlaybook(playbook: unknown): Partial<Record<ReelsPlatform, number>> {
  const pb = playbook && typeof playbook === "object" ? playbook as Record<string, unknown> : {};
  const root = pb.reels_brain_patterns && typeof pb.reels_brain_patterns === "object" ? pb.reels_brain_patterns as Record<string, unknown> : {};
  const brains = root.platform_brains && typeof root.platform_brains === "object" ? root.platform_brains as Record<string, unknown> : {};
  const out: Partial<Record<ReelsPlatform, number>> = {};
  for (const platform of ["tiktok", "instagram", "youtube"] as ReelsPlatform[]) {
    const brain = brains[platform] && typeof brains[platform] === "object" ? brains[platform] as Record<string, unknown> : {};
    out[platform] = Array.isArray(brain.patterns) ? brain.patterns.length : 0;
  }
  return out;
}

function daysSince(value: string | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / (24 * 60 * 60 * 1000)));
}

// GET ?niche= — platform-aware brain lab summary: corpus, patterns, winners, providers.
export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: true, niche: null, platforms: [], warning: "Supabase не настроен" }, { headers: { "Cache-Control": "no-store" } });
    const niche = String(req.nextUrl.searchParams.get("niche") || "").trim();
    if (!niche) return NextResponse.json({ error: "нужна niche" }, { status: 400 });

    const [{ data: videos, error: videosError }, { data: winners, error: winnersError }, { data: playbookRows, error: playbookError }] = await Promise.all([
      db.from("viral_videos")
        .select("platform,virality_score,analyzed,hook_text,format_detected,sound_title,source_orbit_id")
        .eq("niche", niche)
        .order("virality_score", { ascending: false, nullsFirst: false })
        .limit(1000),
      db.from("content_assets")
        .select("winner_learnings")
        .eq("niche", niche)
        .eq("is_winner", true)
        .order("winner_at", { ascending: false })
        .limit(100),
      db.from("niche_playbooks")
        .select("playbook")
        .eq("niche", niche)
        .order("updated_at", { ascending: false })
        .limit(1),
    ]);

    if (videosError) return NextResponse.json({ error: videosError.message }, { status: 500 });
    const playbook = (playbookRows as { playbook?: unknown }[] | null)?.[0]?.playbook;
    const patternCounts = playbookError ? {} : patternCountsFromPlaybook(playbook);
    const platforms = buildReelsBrainPlatformSummary({
      videos: (videos as Parameters<typeof buildReelsBrainPlatformSummary>[0]["videos"] | null) || [],
      winners: winnersError ? [] : ((winners as Parameters<typeof buildReelsBrainPlatformSummary>[0]["winners"] | null) || []),
      patternCounts,
    }).map((platform) => ({
      ...platform,
      relearn_policy: sourceRelearnPolicy(playbook, platform.platform),
      quality_gates: corpusQualityGate(playbook, platform.platform),
      recommended_queries: recommendSourceQueries(playbook, niche, platform.platform),
      training_readiness: assessTrainingReadiness(playbook, platform.platform, {
        videos: platform.videos,
        analyzed: platform.analyzed,
        patterns: platform.pattern_count,
        winners: platform.winners,
      }),
      provider_history: sourceProviderHistory(playbook, platform.platform).slice(0, 5),
      query_leaderboard: queryLeaderboard(playbook, platform.platform).slice(0, 5),
      suppressed_queries: suppressedSourceQueries(playbook, platform.platform).slice(0, 5),
      recovery_queries: recoverableSourceQueries(playbook, platform.platform).slice(0, 3),
    }));
    const platformsWithAlerts = platforms.map((platform) => {
      const preferred = preferredSourceProviders(playbook)[normalizeShortPlatform(platform.platform)];
      const staleDays = daysSince(preferred?.updated_at);
      const drifted = sourceProviderHistory(playbook, platform.platform).slice(0, 2)
        .map((row) => row.provider)
        .filter(Boolean);
      const championChangedRecently = drifted.length > 1 && drifted[0] !== drifted[1];
      const stale = staleDays != null && staleDays > platform.relearn_policy.stale_days;
      const alerts = [
        !platform.training_readiness.ready ? `brain not ready: ${platform.training_readiness.missing.join(", ")}` : "",
        stale ? `provider stale: ${staleDays}d` : "",
        championChangedRecently ? "provider drift detected" : "",
      ].filter(Boolean);
      return {
        ...platform,
        preferred_provider: preferred || null,
        provider_stale_days: staleDays,
        provider_drift: championChangedRecently,
        alerts,
        status: alerts.length ? (platform.training_readiness.ready ? "watch" : "weak") : "ready",
      };
    });

    return NextResponse.json({
      ok: true,
      niche,
      total_videos: platformsWithAlerts.reduce((sum, platform) => sum + platform.videos, 0),
      total_winners: platformsWithAlerts.reduce((sum, platform) => sum + platform.winners, 0),
      platforms: platformsWithAlerts,
      preferred_source_providers: preferredSourceProviders(playbook),
      source_provider_history: sourceProviderHistory(playbook).slice(0, 15),
      incidents: incidentHistory(playbook).slice(0, 20),
      automation_history: automationRunHistory(playbook).slice(0, 10),
      warnings: [winnersError?.message, playbookError?.message].filter(Boolean),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "summary reels-brain упал: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
