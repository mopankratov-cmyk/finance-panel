import { NextRequest, NextResponse } from "next/server";
import { buildRnpTable } from "@/lib/rnp/buildTable";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest, ctx: { params: Promise<{ shop: string }> }) {
  const { shop } = await ctx.params;
  const sp = new URL(request.url).searchParams;
  const from = sp.get("date_from") || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const to = sp.get("date_to") || new Date().toISOString().slice(0, 10);
  const { cabinetId, label } = await resolveShopCabinet(shop);
  const res = await buildRnpTable(from, to, cabinetId, label);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: 500 });
  return NextResponse.json(res);
}
