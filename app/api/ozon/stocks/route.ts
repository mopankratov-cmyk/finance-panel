import { NextRequest, NextResponse } from "next/server";
import { getActiveOzonCreds } from "@/lib/ozon/cabinet";
import { ozonStocks, ozonImages } from "@/lib/ozon/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Ozon остатки: по SKU (сводно free/reserved) + раскладка по складам.
export async function GET(request: NextRequest) {
  const cab = await getActiveOzonCreds(new URL(request.url).searchParams.get("cabinet"));
  if (!cab.ok) return NextResponse.json({ rows: [], warehouses: [], error: cab.error, noCabinet: true });

  const r = await ozonStocks(cab.creds);
  if (!r.ok) return NextResponse.json({ rows: [], warehouses: [], error: r.error }, { status: 502 });

  // агрегируем по артикулу
  const byArt = new Map<string, { art: string; name: string; external_id: string; free: number; reserved: number; byWh: Record<string, number> }>();
  const whSet = new Set<string>();
  for (const s of r.rows) {
    whSet.add(s.warehouse);
    const e = byArt.get(s.article) ?? { art: s.article, name: s.name, external_id: String(s.sku), free: 0, reserved: 0, byWh: {} };
    e.free += s.free; e.reserved += s.reserved;
    e.byWh[s.warehouse] = (e.byWh[s.warehouse] ?? 0) + s.free;
    byArt.set(s.article, e);
  }
  const { byOffer } = await ozonImages(cab.creds);
  const warehouses = [...whSet].sort();
  const rows = [...byArt.values()].map((r) => ({ ...r, img_url: byOffer[r.art] ?? null })).sort((a, b) => b.free - a.free);
  const totalFree = rows.reduce((s, x) => s + x.free, 0);

  return NextResponse.json({ cabinet: cab.name, warehouses, rows, count: rows.length, totalFree });
}
