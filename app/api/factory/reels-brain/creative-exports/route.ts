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

function keyOf(niche: unknown, platform: unknown) {
  return `${text(niche)}__${text(platform).toLowerCase()}`;
}

function boolFlag(value: string) {
  return value === "1" || value === "true" || value === "yes";
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
    const exactReadyOnly = boolFlag(text(req.nextUrl.searchParams.get("exact_ready_only")).toLowerCase());
    const exportsRoot = ((body as JsonRecord).segment_creative_exports || {}) as JsonRecord;
    const generationRows = list((body as JsonRecord).generation_readiness && ((body as JsonRecord).generation_readiness as JsonRecord).items);
    const generationMap = new Map(generationRows.map((row) => [keyOf(row.niche, row.platform), row] as const));
    const withGenerationReadiness = (row: JsonRecord): JsonRecord => {
      const generation = generationMap.get(keyOf(row.niche, row.platform)) || null;
      return {
        ...row,
        generation_readiness: generation,
        high_trust_generation_ready: Boolean(generation?.high_trust_generation_ready),
        brief_ready: Boolean(generation?.brief_ready),
        content_solution_ready: Boolean(generation?.content_solution_ready),
        publishable_exact: Boolean(
          row.publishable_exact
          || generation?.publishable_exact,
        ),
      };
    };
    const matches = (row: JsonRecord) => {
      const laneOk = !lane || text(row.lane) === lane;
      const nicheOk = !niche || text(row.niche) === niche;
      const platformOk = !platform || text(row.platform) === platform;
      const exactOk = !exactReadyOnly || Boolean(
        row.publishable_exact
        || ((row.generator_bundle as JsonRecord | null)?.exact_segment_ready === true)
        || (
          text((row.trust as JsonRecord).proof_quality) === "exact_segment"
          && text(row.lane) === "ship"
          && ((row.trust as JsonRecord | null)?.exact_segment_ready === true)
        ),
      );
      return laneOk && nicheOk && platformOk && exactOk;
    };
    const allItems = list(exportsRoot.items).map(withGenerationReadiness);
    const filtered = allItems.filter(matches);

    return NextResponse.json({
      ok: true,
      lane: lane || null,
      niche: niche || null,
      platform: platform || null,
      summary: {
        ...(exportsRoot.summary || {}),
        filtered_total: filtered.length,
        filtered_ship: filtered.filter((row: JsonRecord) => text(row.lane) === "ship").length,
        filtered_validate: filtered.filter((row: JsonRecord) => text(row.lane) === "validate").length,
        filtered_research: filtered.filter((row: JsonRecord) => text(row.lane) === "research").length,
        filtered_generation_ready: filtered.filter((row: JsonRecord) => Boolean(row.high_trust_generation_ready)).length,
        filtered_publishable_exact: filtered.filter((row: JsonRecord) => Boolean(row.publishable_exact)).length,
        exact_ready_only: exactReadyOnly,
      },
      ship_now: list(exportsRoot.ship_now).map(withGenerationReadiness).filter(matches),
      validate_next: list(exportsRoot.validate_next).map(withGenerationReadiness).filter(matches),
      research_queue: list(exportsRoot.research_queue).map(withGenerationReadiness).filter(matches),
      items: filtered,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      error: "creative-exports reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500 });
  }
}
