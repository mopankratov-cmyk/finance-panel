import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";
import { selectCreativeBriefFromSegmentLayers } from "@/lib/factory/reelsBrainCreativeBriefSource";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function list(value: unknown, limit = 6) {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean).slice(0, limit)
    : [];
}

function legacyTransferNote(niche: string, platform: string) {
  return `Legacy fallback не доказывает exact segment ${niche} × ${platform}; решение можно использовать только как control/brief слой.`;
}

export function normalizeLegacyCreativeSolution(
  payload: Record<string, unknown>,
  requested: { niche: string; platform: string },
) {
  const existingGate = (payload.quality_gate && typeof payload.quality_gate === "object"
    ? payload.quality_gate
    : {}) as Record<string, unknown>;
  const blockedReasons = Array.from(new Set([
    ...list(existingGate.blocked_reasons, 6),
    legacyTransferNote(requested.niche, requested.platform),
  ]));
  const allowedModes = Array.from(new Set([
    ...list(existingGate.allowed_generation_modes, 4).filter((mode) => mode === "control_ready" || mode === "brief_only"),
    "control_ready",
    "brief_only",
  ]));
  const fitSummary = (payload.fit_summary && typeof payload.fit_summary === "object"
    ? payload.fit_summary
    : {}) as Record<string, unknown>;
  const contentDecision = (payload.content_decision && typeof payload.content_decision === "object"
    ? payload.content_decision
    : {}) as Record<string, unknown>;
  const executionNote = text(contentDecision.execution_note);

  return {
    ...payload,
    route: "creative_solution",
    source: text(payload.source) || "legacy_creative_brief",
    requested_segment: {
      niche: requested.niche,
      platform: requested.platform,
    },
    fit_summary: {
      mode: text(fitSummary.mode) || "broad_transfer",
      requested_niche: requested.niche,
      requested_platform: requested.platform,
      matched_niche: text(fitSummary.matched_niche || payload.niche),
      matched_platform: text(fitSummary.matched_platform || payload.platform),
      is_exact_match: false,
      transfer_note: text(fitSummary.transfer_note) || legacyTransferNote(requested.niche, requested.platform),
    },
    quality_gate: {
      ...existingGate,
      status: text(existingGate.status) === "not_ready" ? "not_ready" : "needs_validation",
      source: text(existingGate.source) || "legacy_fallback_guard",
      allowed_generation_modes: allowedModes,
      blocked_reasons: blockedReasons,
      exact_segment_ready: false,
    },
    content_decision: {
      ...contentDecision,
      decision: text(contentDecision.decision) || "validate",
      execution_note: executionNote
        ? `${executionNote} Exact-proof пока не закрыт.`
        : "Legacy fallback: запускать только как control-ready тест, пока exact-proof не закрыт.",
    },
  };
}

export async function GET(req: NextRequest) {
  try {
    const niche = text(req.nextUrl.searchParams.get("niche")) || "ru_toys";
    const platform = text(req.nextUrl.searchParams.get("platform")).toLowerCase();
    const reportUrl = new URL("/api/factory/reels-brain/report", req.nextUrl.origin);
    reportUrl.searchParams.set("niches", niche);
    reportUrl.searchParams.set("limit", "40");
    const reportResponse = await internalFetch(reportUrl);
    const reportBody = await reportResponse.json().catch(() => ({}));
    if (reportResponse.ok) {
      const solution = selectCreativeBriefFromSegmentLayers({
        niche,
        platform,
        segmentSolutions: reportBody.segment_solutions || null,
        segmentSolutionMatrix: reportBody.segment_solution_matrix || null,
        segmentGenerationPacks: reportBody.segment_generation_packs || null,
      });
      if (solution) {
        return NextResponse.json({
          ...solution,
          route: "creative_solution",
        }, { headers: { "Cache-Control": "no-store" } });
      }
    }

    const fallbackUrl = new URL("/api/factory/reels-brain/creative-brief", req.nextUrl.origin);
    for (const [key, value] of req.nextUrl.searchParams.entries()) {
      fallbackUrl.searchParams.set(key, value);
    }
    const fallbackResponse = await internalFetch(fallbackUrl);
    const fallbackBody = await fallbackResponse.json().catch(() => ({}));
    if (!fallbackResponse.ok) {
      return NextResponse.json(fallbackBody, { status: fallbackResponse.status });
    }
    return NextResponse.json(
      normalizeLegacyCreativeSolution(fallbackBody as Record<string, unknown>, { niche, platform }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json({
      error: "creative-solution reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500 });
  }
}
