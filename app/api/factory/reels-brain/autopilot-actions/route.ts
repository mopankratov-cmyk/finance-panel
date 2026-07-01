import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

async function economics(req: NextRequest) {
  const url = new URL("/api/factory/reels-brain/learning-economics", req.nextUrl.origin);
  url.searchParams.set("niches", req.nextUrl.searchParams.get("niches") || "ru_toys,ru_clothing,ru_cosmetics");
  url.searchParams.set("limit", req.nextUrl.searchParams.get("limit") || "80");
  const response = await internalFetch(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || response.statusText);
  return body;
}

export async function GET(req: NextRequest) {
  try {
    const data = await economics(req);
    return NextResponse.json({
      ok: true,
      autopilot_actions: data.autopilot_actions || null,
      cost_governor: data.cost_governor || null,
      discovery_brain: data.discovery_brain || null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "autopilot-actions reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
