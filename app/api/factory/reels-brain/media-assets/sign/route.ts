import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function signApifyAssetUrl(assetUrl: string) {
  const token = String(process.env.APIFY_TOKEN || "").trim();
  if (!token) throw new Error("APIFY_TOKEN не настроен");
  const url = new URL(assetUrl);
  if (url.hostname !== "api.apify.com") throw new Error("поддерживаются только api.apify.com assets");
  if (!url.pathname.includes("/key-value-stores/") || !url.pathname.includes("/records/")) {
    throw new Error("поддерживаются только Apify key-value-store records");
  }
  if (!url.searchParams.has("token")) url.searchParams.set("token", token);
  return url.href;
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const assetUrl = String(body?.asset_url || "").trim();
    if (!assetUrl) return NextResponse.json({ error: "asset_url пустой" }, { status: 400 });

    return NextResponse.json({
      ok: true,
      mode: "reels_brain_media_asset_signer",
      signed_url: signApifyAssetUrl(assetUrl),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "media-assets/sign упал: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
