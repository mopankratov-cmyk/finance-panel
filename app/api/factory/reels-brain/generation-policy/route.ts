import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(req: NextRequest) {
  try {
    const niches = req.nextUrl.searchParams.get("niches") || "ru_toys,ru_clothing,ru_cosmetics";
    const limit = req.nextUrl.searchParams.get("limit") || "80";
    const url = new URL("/api/factory/reels-brain/learning-economics", req.nextUrl.origin);
    url.searchParams.set("niches", niches);
    url.searchParams.set("limit", limit);
    const response = await internalFetch(url);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return NextResponse.json(body, { status: response.status });
    return NextResponse.json({
      ok: true,
      generation_policy: body.generation_policy || null,
      segment_solution_matrix: body.segment_solution_matrix || null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      error: "generation-policy reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500 });
  }
}
