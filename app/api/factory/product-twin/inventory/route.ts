import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { buildProductTwinInventory, productTwinInventorySummary } from "@/lib/factory/productTwinInventory";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function cleanList(value: string | null): string[] {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean).slice(0, 200);
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const articles = cleanList(sp.get("articles"));
  const limit = Math.max(1, Math.min(200, Number(sp.get("limit") || 200) || 200));
  const candidateLimit = Math.max(1, Math.min(20, Number(sp.get("candidate_limit") || 6) || 6));
  const probeLimit = Math.max(0, Math.min(20, Number(sp.get("probe_limit") || 8) || 8));
  const items = await buildProductTwinInventory({ articles: articles.length ? articles : undefined, limit, candidateLimit, probeLimit });
  return NextResponse.json({
    ok: true,
    summary: productTwinInventorySummary(items),
    items,
  }, { headers: { "Cache-Control": "no-store" } });
}
