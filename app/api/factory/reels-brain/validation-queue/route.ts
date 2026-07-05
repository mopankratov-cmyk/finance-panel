import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(req: NextRequest) {
  try {
    const url = new URL("/api/factory/reels-brain/report", req.nextUrl.origin);
    url.searchParams.set("niches", req.nextUrl.searchParams.get("niches") || "ru_toys,ru_clothing,ru_cosmetics");
    url.searchParams.set("limit", req.nextUrl.searchParams.get("limit") || "80");
    const response = await internalFetch(url);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return NextResponse.json(body, { status: response.status });
    return NextResponse.json({
      ok: true,
      validation_queue: body.autopilot_actions?.validation_queue || null,
      measurement_plan: body.measurement_plan || null,
      autopilot_actions: body.autopilot_actions || null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      error: "validation-queue reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500 });
  }
}
