import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";
import { selectCreativeBriefFromSegmentLayers } from "@/lib/factory/reelsBrainCreativeBriefSource";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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
    return NextResponse.json({
      ...fallbackBody,
      route: "creative_solution",
      source: fallbackBody?.source || "legacy_creative_brief",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      error: "creative-solution reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500 });
  }
}
