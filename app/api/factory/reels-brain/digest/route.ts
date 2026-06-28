import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  assessTrainingReadiness,
  corpusQualityGate,
  incidentHistory,
  normalizeShortPlatform,
  preferredSourceProviders,
  queryLeaderboard,
  recommendSourceQueries,
  sourceProviderHistory,
  sourceRelearnPolicy,
} from "@/lib/factory/reelsBrainPlaybook";
import { buildReelsBrainPlatformSummary } from "@/lib/factory/reelsBrainSummary";
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

function providerShiftSignal(playbook: unknown, platform: ReelsPlatform) {
  const history = sourceProviderHistory(playbook, platform).slice(0, 2);
  const latest = history[0];
  const previous = history[1];
  const active = Boolean(latest?.provider && previous?.provider && latest.provider !== previous.provider);
  const source = latest?.source || null;
  return {
    active,
    from_provider: active ? previous?.provider || null : null,
    to_provider: active ? latest?.provider || null : null,
    source,
    updated_at: latest?.updated_at || null,
    reason: active
      ? source === "bake-off"
        ? `${platform} shifted provider after bake-off`
        : `${platform} shifted provider after source relearn`
      : null,
  };
}

function retrySignal(input: {
  platform: ReelsPlatform;
  status: "ready" | "weak";
  readiness_score: number;
  preferred_provider_age_days: number | null;
  relearn_policy: { stale_days: number };
  provider_shift: ReturnType<typeof providerShiftSignal>;
  latest_incident_kind: string | null;
}) {
  if (input.provider_shift.active && input.provider_shift.to_provider) {
    return {
      recommended: true,
      action: "retry_shifted_provider",
      reason: `${input.platform} should retry on ${input.provider_shift.to_provider} after lane shift`,
    };
  }
  if (input.preferred_provider_age_days != null && input.preferred_provider_age_days > input.relearn_policy.stale_days) {
    return {
      recommended: true,
      action: "source_refresh",
      reason: `${input.platform} preferred provider is stale`,
    };
  }
  if (input.latest_incident_kind === "empty_intake" || input.latest_incident_kind === "low_yield") {
    return {
      recommended: true,
      action: "mini_bake_off",
      reason: `${input.platform} latest intake quality is weak`,
    };
  }
  if (input.status !== "ready" || input.readiness_score < 50) {
    return {
      recommended: true,
      action: "loop",
      reason: `${input.platform} readiness still needs more corpus`,
    };
  }
  return {
    recommended: false,
    action: "monitor",
    reason: `${input.platform} is stable enough`,
  };
}

export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: true, niche: null, digest: null, warning: "Supabase не настроен" }, { headers: { "Cache-Control": "no-store" } });
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
    }).map((platform) => {
      const readiness = assessTrainingReadiness(playbook, platform.platform, {
        videos: platform.videos,
        analyzed: platform.analyzed,
        patterns: platform.pattern_count,
        winners: platform.winners,
      });
      const preferred = preferredSourceProviders(playbook)[normalizeShortPlatform(platform.platform)];
      const recentHistory = sourceProviderHistory(playbook, platform.platform).slice(0, 2);
      const staleDays = daysSince(preferred?.updated_at);
      const shift = providerShiftSignal(playbook, platform.platform);
      const latestPlatformIncident = incidentHistory(playbook, platform.platform)[0];
      const retry = retrySignal({
        platform: platform.platform,
        status: readiness.ready ? "ready" : "weak",
        readiness_score: readiness.score,
        preferred_provider_age_days: staleDays,
        relearn_policy: sourceRelearnPolicy(playbook, platform.platform),
        provider_shift: shift,
        latest_incident_kind: latestPlatformIncident?.kind || null,
      });
      return {
        platform: platform.platform,
        status: readiness.ready ? "ready" : "weak",
        readiness_score: readiness.score,
        preferred_provider: preferred?.provider || null,
        preferred_provider_age_days: staleDays,
        provider_drift: recentHistory.length > 1 && recentHistory[0].provider !== recentHistory[1].provider,
        provider_shift: shift,
        retry_signal: retry,
        videos: platform.videos,
        analyzed: platform.analyzed,
        winners: platform.winners,
        pattern_count: platform.pattern_count,
        top_query: queryLeaderboard(playbook, platform.platform)[0]?.query || recommendSourceQueries(playbook, niche, platform.platform)[0] || null,
        relearn_policy: sourceRelearnPolicy(playbook, platform.platform),
        quality_gates: corpusQualityGate(playbook, platform.platform),
      };
    });

    return NextResponse.json({
      ok: true,
      niche,
      digest: {
        niche,
        overall_status: platforms.every((row) => row.status === "ready") ? "ready" : "watch",
        total_incidents: incidentHistory(playbook).length,
        critical_incidents: incidentHistory(playbook).filter((row) => row.severity === "critical").length,
        latest_incidents: incidentHistory(playbook).slice(0, 8),
        platforms,
      },
      warnings: [winnersError?.message, playbookError?.message].filter(Boolean),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "digest reels-brain упал: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
