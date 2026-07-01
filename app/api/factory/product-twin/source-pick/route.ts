import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { pickProductSourceCandidates } from "@/lib/factory/productSourcePicker";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const article = String(req.nextUrl.searchParams.get("article") || "").trim();
  const product = String(req.nextUrl.searchParams.get("product") || article).trim();
  if (!article) return NextResponse.json({ ok: false, error: "нужен article" }, { status: 400 });
  const limit = Math.max(1, Math.min(20, Number(req.nextUrl.searchParams.get("limit") || 5) || 5));
  const candidates = await pickProductSourceCandidates({ article, product, limit, probeLimit: Math.max(limit, 10) });
  return NextResponse.json({ ok: Boolean(candidates[0]), article, product, picked: candidates[0] || null, candidates }, { headers: { "Cache-Control": "no-store" } });
}
