import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { selectCreativeBriefFromSegmentLayers } from "@/lib/factory/reelsBrainCreativeBriefSource";
import { selectCreativeBriefBrainWithTrust } from "@/lib/factory/reelsBrainCreativeBrief";
import { buildReelsBrainDecisionPack } from "@/lib/factory/reelsBrainDecisionPack";
import { normalizeLegacyCreativeBrief } from "@/lib/factory/reelsBrainLegacyCreativeBriefGuard";
import type { ReelsBrainMetricRow } from "@/lib/factory/reelsBrainOperatingSystem";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

type Example = {
  id?: string | number;
  url?: string | null;
  hook?: string | null;
  score?: number;
  views?: number;
};

type Pattern = {
  pattern_id?: string;
  hook_type?: string;
  hook_label?: string;
  structure_type?: string;
  structure_label?: string;
  retention_mechanism?: string;
  retention_label?: string;
  emotion?: string;
  emotion_label?: string;
  viral_logic?: string;
  viral_logic_label?: string;
  frequency?: number;
  strength_score?: number;
  quality_label?: string;
  quality_score?: number;
  relevance_score?: number;
  quality_reasons?: string[];
  avg_views?: number;
  hooks?: string[];
  sounds?: string[];
  examples?: Example[];
};

type CrossPlatformPattern = Pattern & {
  platforms?: string[];
  platform_count?: number;
  total_frequency?: number;
  avg_strength_score?: number;
};

type AntiPattern = {
  anti_pattern_id?: string;
  label?: string;
  trigger_reason?: string;
  severity?: string;
  affected_patterns?: number;
  total_frequency?: number;
  avg_quality_score?: number;
  avg_relevance_score?: number;
  action?: string;
};

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function boolFlag(value: string) {
  return value === "1" || value === "true" || value === "yes";
}

export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
    const niche = text(req.nextUrl.searchParams.get("niche")) || "ru_toys";
    const productType = text(req.nextUrl.searchParams.get("product_type"));
    const platform = text(req.nextUrl.searchParams.get("platform")).toLowerCase();
    const strictExact = boolFlag(text(req.nextUrl.searchParams.get("strict_exact")).toLowerCase());

    const { data, error } = await db
      .from("niche_playbooks")
      .select("playbook")
      .eq("niche", niche)
      .limit(1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const { data: feedbackRows } = await db
      .from("post_metrics")
      .select("recipe_id,platform,views,watch_rate,hook_rate,hold_rate,completion_rate,ctr_card,saves,marketplace_orders,revenue,posted_at,pulled_at")
      .limit(300);

    const reportUrl = new URL("/api/factory/reels-brain/report", req.nextUrl.origin);
    reportUrl.searchParams.set("niches", niche);
    reportUrl.searchParams.set("limit", "40");
    const reportResponse = await internalFetch(reportUrl);
    const reportBody = await reportResponse.json().catch(() => ({}));
    if (reportResponse.ok) {
      const segmentBrief = selectCreativeBriefFromSegmentLayers({
        niche,
        platform,
        segmentSolutions: reportBody.segment_solutions || null,
        segmentSolutionMatrix: reportBody.segment_solution_matrix || null,
        segmentGenerationPacks: reportBody.segment_generation_packs || null,
        strictExact,
      });
      if (segmentBrief) {
        return NextResponse.json(segmentBrief, { headers: { "Cache-Control": "no-store" } });
      }
      if (strictExact) {
        return NextResponse.json({
          ok: false,
          error: `Нет exact-ready brief для ${niche} × ${platform || "unknown"}`,
          requested_segment: {
            niche,
            platform,
          },
          quality_gate: {
            status: "not_ready",
            exact_segment_ready: false,
            allowed_generation_modes: ["brief_only", "research_only"],
            blocked_reasons: [
              `Для ${niche} × ${platform || "unknown"} пока нет exact-proof segment brief. Сначала закрой exact segment queue и validation loop.`,
            ],
          },
        }, { status: 409, headers: { "Cache-Control": "no-store" } });
      }
    }

    const playbook = ((data as { playbook?: Record<string, unknown> }[] | null)?.[0]?.playbook || {}) as Record<string, unknown>;
    const root = (playbook.reels_brain_patterns || {}) as Record<string, unknown>;
    const platformBrains = (root.platform_brains || {}) as Record<string, { generator_ready_patterns?: Pattern[]; patterns?: Pattern[]; anti_patterns?: AntiPattern[] }>;
    const crossPlatformPatterns = Array.isArray(root.cross_platform_patterns) ? root.cross_platform_patterns as CrossPlatformPattern[] : [];
    const meta = (root.meta_brain || {}) as { generator_ready_patterns?: Pattern[]; patterns?: Pattern[]; anti_patterns?: AntiPattern[] };
    const trustDecision = selectCreativeBriefBrainWithTrust({ playbook, platform, feedbackRows: ((feedbackRows || []) as ReelsBrainMetricRow[]) });

    const usePlatform = trustDecision.selected_scope === "platform" && platform && platformBrains[platform];
    const platformPatterns = usePlatform
      ? (platformBrains[platform].generator_ready_patterns?.length
        ? platformBrains[platform].generator_ready_patterns
        : platformBrains[platform].patterns) || []
      : [];
    const fallbackPatterns = meta.generator_ready_patterns?.length ? meta.generator_ready_patterns : meta.patterns || [];
    const patterns = platformPatterns.length ? platformPatterns : fallbackPatterns;
    const antiPatterns = usePlatform && platformBrains[platform]?.anti_patterns?.length
      ? platformBrains[platform].anti_patterns || []
      : meta.anti_patterns || [];
    if (!patterns.length) {
      return NextResponse.json({ ok: false, error: "Нет готовых паттернов для этой ниши" }, { status: 404 });
    }

    const pack = buildReelsBrainDecisionPack({
      patterns,
      crossPlatformPatterns,
      antiPatterns,
      trustDecision,
      niche,
      productType: productType || "",
      platform,
      limit: 3,
    });
    const best = pack.primary;
    if (!best) {
      return NextResponse.json({ ok: false, error: "Не удалось собрать decision pack для этой ниши" }, { status: 404 });
    }

    return NextResponse.json(
      normalizeLegacyCreativeBrief({
        ok: true,
        selected_pattern: {
          pattern_id: best.pattern_id || null,
          hook_type: best.hook_type || null,
          structure_type: best.structure_type || null,
          retention_mechanism: best.retention_mechanism || null,
          quality_label: best.quality_label || null,
          trust_scope: trustDecision.selected_scope,
        },
        ...best,
        alternatives: pack.alternatives,
        decision_pack: pack.decision_pack,
      }, {
        niche,
        platform,
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json({ error: "creative-brief reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
