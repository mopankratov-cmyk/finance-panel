import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";
import { buildReelsBrainSegmentStabilityAudit } from "@/lib/factory/reelsBrainSegmentStabilityAudit";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(req: NextRequest) {
  try {
    const lane = text(req.nextUrl.searchParams.get("lane"));
    const niche = text(req.nextUrl.searchParams.get("niche"));
    const platform = text(req.nextUrl.searchParams.get("platform"));
    const niches = req.nextUrl.searchParams.get("niches") || "ru_toys,ru_clothing,ru_cosmetics";
    const limit = req.nextUrl.searchParams.get("limit") || "80";

    const url = new URL("/api/factory/reels-brain/decision-snapshot", req.nextUrl.origin);
    url.searchParams.set("niches", niches);
    url.searchParams.set("limit", limit);
    if (lane) url.searchParams.set("lane", lane);
    if (niche) url.searchParams.set("niche", niche);
    if (platform) url.searchParams.set("platform", platform);

    const response = await internalFetch(url);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return NextResponse.json(body, { status: response.status });

    const audit = buildReelsBrainSegmentStabilityAudit({
      decisionSnapshot: body as {
        summary?: Record<string, unknown> | null;
        items?: Record<string, unknown>[];
      },
      limit: Number(limit),
    });

    return NextResponse.json({
      ok: true,
      lane: lane || null,
      niche: niche || null,
      platform: platform || null,
      ...audit,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      error: "stability-audit reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500 });
  }
}
