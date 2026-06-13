import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { computeLocalization, warehouseOkrug, type Okrug } from "@/lib/wb/localization";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Локализация WB: % локализации, ИЛ, ИРП + рекомендации какой склад грузить. Из wb_orders за 30 дней.
export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ localizationPct: 0, il: 0, irp: 0, byOkrug: [], recommendations: [] });

  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  // Серверный агрегат (быстро, один вызов). Фолбэк на пагинацию, если RPC ещё не создан в БД.
  const orders: { region: string | null; warehouse: string | null }[] = [];
  const agg = await db.rpc("wb_localization_30d");
  if (!agg.error && Array.isArray(agg.data)) {
    for (const r of agg.data as { region: string | null; warehouse: string | null; cnt: number }[]) {
      const n = Number(r.cnt ?? 0);
      for (let i = 0; i < n; i++) orders.push({ region: r.region, warehouse: r.warehouse });
    }
  } else {
    for (let page = 0; page < 30; page++) {
      const { data, error } = await db
        .from("wb_orders")
        .select("region, warehouse")
        .gte("date", since)
        .order("date")
        .range(page * 1000, page * 1000 + 999);
      if (error || !data?.length) break;
      orders.push(...(data as { region: string | null; warehouse: string | null }[]));
      if (data.length < 1000) break;
    }
  }

  // округа, где у нас уже есть остаток (по складам в wb_stocks)
  const { data: stocks } = await db.from("wb_stocks").select("warehouse, quantity").limit(2000);
  const stockOkrugs = new Set<Okrug>();
  for (const s of stocks ?? []) {
    if (Number(s.quantity ?? 0) <= 0) continue;
    const ok = warehouseOkrug(s.warehouse as string);
    if (ok) stockOkrugs.add(ok);
  }

  const result = computeLocalization(orders, stockOkrugs);
  return NextResponse.json(result);
}
