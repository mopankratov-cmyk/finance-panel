import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";
import { selectCreativeBriefFromSegmentLayers } from "@/lib/factory/reelsBrainCreativeBriefSource";
import { normalizeLegacyCreativeSolution } from "@/lib/factory/reelsBrainLegacyCreativeSolutionGuard";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function boolFlag(value: string) {
  return value === "1" || value === "true" || value === "yes";
}

export async function GET(req: NextRequest) {
  try {
    const niche = text(req.nextUrl.searchParams.get("niche")) || "ru_toys";
    const platform = text(req.nextUrl.searchParams.get("platform")).toLowerCase();
    const strictExact = boolFlag(text(req.nextUrl.searchParams.get("strict_exact")).toLowerCase());
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
        generationReadiness: reportBody.generation_readiness || null,
        strictExact,
      });
      if (solution) {
        return NextResponse.json({
          ...solution,
          route: "creative_solution",
        }, { headers: { "Cache-Control": "no-store" } });
      }
      if (strictExact) {
        return NextResponse.json({
          ok: false,
          route: "creative_solution",
          error: `Нет exact-ready creative solution для ${niche} × ${platform || "unknown"}`,
          requested_segment: {
            niche,
            platform,
          },
          quality_gate: {
            status: "not_ready",
            exact_segment_ready: false,
            allowed_generation_modes: ["brief_only", "research_only"],
            blocked_reasons: [
              `Для ${niche} × ${platform || "unknown"} пока нет exact-proof creative solution. Сначала нужен exact segment validation.`,
            ],
          },
        }, { status: 409, headers: { "Cache-Control": "no-store" } });
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
