import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

type JsonRecord = Record<string, unknown>;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function list(value: unknown) {
  return Array.isArray(value) ? value as JsonRecord[] : [];
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL("/api/factory/reels-brain/learning-economics", req.nextUrl.origin);
    url.searchParams.set("niches", req.nextUrl.searchParams.get("niches") || "ru_toys,ru_clothing,ru_cosmetics");
    url.searchParams.set("limit", req.nextUrl.searchParams.get("limit") || "80");
    const response = await internalFetch(url);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return NextResponse.json(body, { status: response.status });

    const lane = text(req.nextUrl.searchParams.get("lane"));
    const niche = text(req.nextUrl.searchParams.get("niche"));
    const platform = text(req.nextUrl.searchParams.get("platform"));
    const exportsRoot = ((body as JsonRecord).segment_creative_exports || {}) as JsonRecord;
    const matches = (row: JsonRecord) => {
      const laneOk = !lane || text(row.lane) === lane;
      const nicheOk = !niche || text(row.niche) === niche;
      const platformOk = !platform || text(row.platform) === platform;
      return laneOk && nicheOk && platformOk;
    };
    const allItems = list(exportsRoot.items);
    const filtered = allItems.filter(matches);

    return NextResponse.json({
      ok: true,
      lane: lane || null,
      niche: niche || null,
      platform: platform || null,
      summary: {
        ...(exportsRoot.summary || {}),
        filtered_total: filtered.length,
        filtered_ship: filtered.filter((row) => text(row.lane) === "ship").length,
        filtered_validate: filtered.filter((row) => text(row.lane) === "validate").length,
        filtered_research: filtered.filter((row) => text(row.lane) === "research").length,
      },
      ship_now: list(exportsRoot.ship_now).filter(matches),
      validate_next: list(exportsRoot.validate_next).filter(matches),
      research_queue: list(exportsRoot.research_queue).filter(matches),
      items: filtered,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      error: "creative-exports reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500 });
  }
}
