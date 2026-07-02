import { NextRequest, NextResponse } from "next/server";
import { debugBrightInstagramPostQuery, debugBrightInstagramQuery, debugEnsembleInstagramSearch } from "@/lib/factory/reelsBrainSources";
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
  if (provider === "apify_tiktok") {
    const data = await debugApifyTiktokSearch(query, 3);
    return NextResponse.json({ ok: true, provider: "apify_tiktok", query, debug: data }, { headers: { "Cache-Control": "no-store" } });
  }
  if (provider === "bright_instagram") {
    const data = await debugBrightInstagramQuery(query, 1);
    return NextResponse.json({ ok: true, provider: "bright_instagram", query, debug: data }, { headers: { "Cache-Control": "no-store" } });
  }
  if (provider === "bright_instagram_post") {
    const data = await debugBrightInstagramPostQuery(query);
    return NextResponse.json({ ok: true, provider: "bright_instagram_post", query, debug: data }, { headers: { "Cache-Control": "no-store" } });
  }
  const data = await debugEnsembleInstagramSearch(query);
  return NextResponse.json({ ok: true, provider: "ensemble_instagram", query, debug: data }, { headers: { "Cache-Control": "no-store" } });
}
