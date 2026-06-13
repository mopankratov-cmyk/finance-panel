import { NextRequest, NextResponse } from "next/server";
import { getActiveOzonCreds } from "@/lib/ozon/cabinet";
import { ozonAnalytics } from "@/lib/ozon/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Ozon воронка: показы/в корзину/заказы/выручка/конверсия по SKU.
export async function GET(request: NextRequest) {
  const sp = new URL(request.url).searchParams;
  const days = Math.min(60, Math.max(1, Number(sp.get("days")) || 14));
  const cab = await getActiveOzonCreds(sp.get("cabinet"));
  if (!cab.ok) return NextResponse.json({ rows: [], error: cab.error, noCabinet: true });

  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const r = await ozonAnalytics(cab.creds, from, to);
  if (!r.ok) return NextResponse.json({ rows: [], error: r.error }, { status: 502 });

  const rows = r.rows
    .map((x) => ({
      ...x,
      revenue: Math.round(x.revenue),
      cr_cart: x.hits_view > 0 ? Math.round((x.hits_tocart / x.hits_view) * 1000) / 10 : null,
      cr_order: x.hits_tocart > 0 ? Math.round((x.ordered_units / x.hits_tocart) * 1000) / 10 : null,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  return NextResponse.json({ cabinet: cab.name, period: { from, to, days }, rows, count: rows.length });
}
