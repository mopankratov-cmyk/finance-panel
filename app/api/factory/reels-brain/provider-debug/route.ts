import { NextRequest, NextResponse } from "next/server";
import { debugEnsembleInstagramSearch } from "@/lib/factory/reelsBrainSources";
import { debugApifyTiktokSearch } from "@/lib/factory/trendSources";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authOk(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const query = String(req.nextUrl.searchParams.get("query") || "skincare routine").trim().slice(0, 120);
  const provider = String(req.nextUrl.searchParams.get("provider") || "ensemble_instagram").trim().toLowerCase();
  const downloadVideos = req.nextUrl.searchParams.get("download_videos") === "true";
  if (provider === "apify_tiktok") {
    const data = await debugApifyTiktokSearch(query, 3, { downloadVideos });
    return NextResponse.json({ ok: true, provider: "apify_tiktok", query, download_videos: downloadVideos, debug: data }, { headers: { "Cache-Control": "no-store" } });
  }
  const data = await debugEnsembleInstagramSearch(query);
  return NextResponse.json({ ok: true, provider: "ensemble_instagram", query, debug: data }, { headers: { "Cache-Control": "no-store" } });
}
