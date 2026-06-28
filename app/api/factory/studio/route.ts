import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildObservability, buildRunSummary, classifyErrorReason, classifyWarningReason } from "@/lib/factory/observability";
import { loadReelsBrainPortfolioDigest } from "@/lib/factory/reelsBrainDigest";
import { buildReelsBrainPlatformSummary } from "@/lib/factory/reelsBrainSummary";
import {
  assessTrainingReadiness,
  corpusQualityGate,
  incidentHistory,
  preferredSourceProviders,
  queryLeaderboard,
  recommendSourceQueries,
  sourceProviderHistory,
  sourceRelearnPolicy,
} from "@/lib/factory/reelsBrainPlaybook";
import type { ReelsPlatform } from "@/lib/factory/reelsBrain";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

// V3 нод-студия: агрегатор данных для экранов 01 (карта осознания) / 02 (лента виральных) / 06 (библиотека).
//   GET            → { niches:[{niche,videos,hooks,playbook,templates,gens}], generations[], recipes[] }
//   GET ?niche=X   → { niche, feed:[виральные видео ниши], templates[], recipes[] }
// Всё best-effort: каждая выборка в своём try → пустой раздел вместо краха. Всегда JSON.

const NICHES = ["cosmetics", "clothing", "toys", "default"];
const NICHE_META: Record<string, { emoji: string; label: string }> = {
  cosmetics: { emoji: "💄", label: "Косметика" },
  clothing: { emoji: "🧥", label: "Одежда" },
  toys: { emoji: "🔫", label: "Игрушки" },
  default: { emoji: "📦", label: "Прочее" },
};

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

async function count(db: any, table: string, niche: string, extra?: (q: any) => any): Promise<number> {
  try {
    let q = db.from(table).select("id", { count: "exact", head: true }).eq("niche", niche);
    if (extra) q = extra(q);
    const { count: c } = await q;
    return c ?? 0;
  } catch { return 0; }
}

function recipeSummary(r: Record<string, unknown>) {
  const plan = (r.run_plan && typeof r.run_plan === "object") ? r.run_plan as Record<string, unknown> : {};
  const nodes = Array.isArray(plan.nodes) ? plan.nodes as Record<string, unknown>[] : [];
  const warnings = Array.isArray(plan.warnings) ? plan.warnings.map((w) => String(w)).filter(Boolean).slice(0, 5) : [];
  const executionLog = Array.isArray(plan.execution_log) ? plan.execution_log.slice(-5) : [];
  const nodeErrors = nodes
    .filter((n) => n.status === "error" || n.error)
    .map((n) => ({
      tool: n.tool || n.engine || null,
      slot: n.slot || n.node_type || null,
      error: String(n.error || "").slice(0, 180),
    }))
    .slice(0, 3);
  return {
    ...r,
    run_plan: undefined,
    step: plan.step || null,
    run_id: plan.run_id || null,
    error: plan.error || null,
    error_category: classifyErrorReason(String(plan.error || "")),
    warnings,
    warnings_count: warnings.length,
    execution_log_count: Array.isArray(plan.execution_log) ? plan.execution_log.length : 0,
    execution_log_tail: executionLog,
    execution_log_last: executionLog.length ? executionLog[executionLog.length - 1] : null,
    run_summary: buildRunSummary(plan),
    catalog_error: plan.catalog_error || null,
    needs_rejudge: r.status === "otk_pass" && !!r.output_url && r.otk_score == null,
    node_errors: nodeErrors,
  };
}

export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
    const niche = (req.nextUrl.searchParams.get("niche") || "").trim();

    // ── режим одной ниши: лента виральных + шаблоны + рецепты ──
    if (niche) {
      let feed: unknown[] = [];
      let templates: unknown[] = [];
      let recipes: unknown[] = [];
      let platform_summary: unknown[] = [];
      let preferred_source_providers: Record<string, unknown> = {};
      let source_provider_history: unknown[] = [];
      let incidents: unknown[] = [];
      try {
        const { data } = await db.from("viral_videos").select("id,url,caption,views,likes,virality_score,hook_text,format_detected,sound_title,platform").eq("niche", niche).order("virality_score", { ascending: false, nullsFirst: false }).limit(24);
        feed = data || [];
      } catch { /* нет корпуса */ }
      try {
        const { data } = await db.from("node_templates").select("id,format_type,niche,confidence,nodes,source_video_url,created_at").eq("niche", niche).order("created_at", { ascending: false }).limit(20);
        templates = (data || []).map((t: Record<string, unknown>) => ({ ...t, nodes_count: Array.isArray(t.nodes) ? t.nodes.length : 0, nodes: undefined }));
      } catch { /* нет шаблонов */ }
      try {
        const { data } = await db.from("node_recipes").select("id,article,niche,mode,status,otk_score,output_url,format_detected,created_at,run_plan").eq("niche", niche).order("created_at", { ascending: false }).limit(20);
        recipes = (data || []).map(recipeSummary);
      } catch { /* нет рецептов */ }
      try {
        const [{ data: videos }, { data: winners }, { data: playbookRows }] = await Promise.all([
          db.from("viral_videos").select("platform,virality_score,analyzed,hook_text,format_detected,sound_title,source_orbit_id").eq("niche", niche).order("virality_score", { ascending: false, nullsFirst: false }).limit(1000),
          db.from("content_assets").select("winner_learnings").eq("niche", niche).eq("is_winner", true).order("winner_at", { ascending: false }).limit(100),
          db.from("niche_playbooks").select("playbook").eq("niche", niche).order("updated_at", { ascending: false }).limit(1),
        ]);
        const playbook = (playbookRows as { playbook?: unknown }[] | null)?.[0]?.playbook;
        platform_summary = buildReelsBrainPlatformSummary({
          videos: (videos as Parameters<typeof buildReelsBrainPlatformSummary>[0]["videos"] | null) || [],
          winners: (winners as Parameters<typeof buildReelsBrainPlatformSummary>[0]["winners"] | null) || [],
          patternCounts: patternCountsFromPlaybook(playbook),
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
        }));
        preferred_source_providers = preferredSourceProviders(playbook);
        source_provider_history = sourceProviderHistory(playbook).slice(0, 15);
        incidents = incidentHistory(playbook).slice(0, 20);
      } catch { /* summary optional */ }
      return NextResponse.json({ ok: true, niche, feed, templates, recipes, platform_summary, preferred_source_providers, source_provider_history, incidents }, { headers: { "Cache-Control": "no-store" } });
    }

    // ── обзор всех ниш ──
    const niches = await Promise.all(NICHES.map(async (n) => {
      const [videos, hooks, templates, gens, pb] = await Promise.all([
        count(db, "viral_videos", n),
        count(db, "viral_hooks", n),
        count(db, "node_templates", n),
        count(db, "content_assets", n, (q) => q.eq("disk", "gen")),
        (async () => { try { const { data } = await db.from("niche_playbooks").select("niche").eq("niche", n).limit(1); return !!(data && data.length); } catch { return false; } })(),
      ]);
      return { niche: n, ...NICHE_META[n], videos, hooks, templates, gens, playbook: pb };
    }));

    let generations: unknown[] = [];
    try {
      const { data } = await db.from("content_assets").select("name,kind,url,niche,article,analysis,created_at").eq("disk", "gen").order("created_at", { ascending: false }).limit(40);
      generations = (data || []).filter((r: Record<string, unknown>) => String(r.url || "").startsWith("http"));
    } catch { /* нет генераций */ }

    let recipes: unknown[] = [];
    let observability: Record<string, unknown> = { sample_runs: 0, running: 0, warning_runs: 0, failed: 0, stability_snapshot: null, quality_signal: null, recent_runs: [], incident_runs: [], status_series: [], step_duration_series: [], slowest_steps: [], failure_diagnostics: null, top_error_categories: [], top_errors: [], top_warning_categories: [], top_warnings: [] };
    let reels_brain_portfolio: Record<string, unknown> | null = null;
    try {
      const { data } = await db.from("node_recipes").select("id,article,niche,mode,status,otk_score,output_url,format_detected,built_by,created_at,run_plan").order("created_at", { ascending: false }).limit(30);
      const rows = (data as Record<string, unknown>[] | null) || [];
      recipes = rows.map(recipeSummary);
      observability = buildObservability(rows);
    } catch { /* нет рецептов */ }
    try {
      reels_brain_portfolio = await loadReelsBrainPortfolioDigest(db, NICHES);
    } catch { /* digest optional */ }

    return NextResponse.json({ ok: true, niches, generations, recipes, observability, reels_brain_portfolio }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "studio crash: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
