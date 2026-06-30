import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { pickProductSource } from "@/lib/factory/productSourcePicker";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const article = String(req.nextUrl.searchParams.get("article") || "").trim();
  const product = String(req.nextUrl.searchParams.get("product") || article).trim();
  if (!article) return NextResponse.json({ ok: false, error: "нужен article" }, { status: 400 });
  const picked = await pickProductSource({ article, product });
  return NextResponse.json({ ok: Boolean(picked), article, product, picked }, { headers: { "Cache-Control": "no-store" } });
}

