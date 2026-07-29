import { NextRequest, NextResponse } from "next/server";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { loadCachedWbRnp } from "@/lib/rnp/tableCache";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest, ctx: { params: Promise<{ shop: string }> }) {
  try {
    const { shop } = await ctx.params;
    const sp = new URL(request.url).searchParams;
    const from = sp.get("date_from") || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const to = sp.get("date_to") || new Date().toISOString().slice(0, 10);
    const turnoverWindowDays = Math.max(3, Math.min(90, Number(sp.get("turnover_days") || 30) || 30));
    const { cabinetId, label } = await resolveShopCabinet(shop);
    if (shop !== "all" && !cabinetId) {
      return NextResponse.json({ error: "WB-кабинет не найден" }, { status: 404 });
    }
    if (!(await hasCabinetAccess(cabinetId))) {
      return NextResponse.json({ error: "Нет доступа к выбранному WB-кабинету" }, { status: 403 });
    }
    const data = await loadCachedWbRnp(
      { from, to, cabinetId, label, turnoverWindowDays },
      { forceRefresh: sp.get("refresh") === "1" },
    );
    return NextResponse.json(data, { headers: { "X-Dashboard-Cache": "hourly-snapshot" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось собрать РНП" },
      { status: 500 },
    );
  }
}
