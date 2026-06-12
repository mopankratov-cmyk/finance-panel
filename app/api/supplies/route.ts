import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export interface SupplyRow {
  nmId: number;
  article: string;
  /** ср. дневные заказы за 30 дней */
  avgDaily: number;
  stock: number;
  inWay: number;
  /** дней до нуля при текущем темпе */
  daysLeft: number | null;
  /** потребность к поставке = avgDaily×горизонт − остаток − в пути (для 30/45/60) */
  need30: number;
  need45: number;
  need60: number;
}

export interface WarehouseSummary {
  warehouse: string;
  quantity: number;
  inWay: number;
  skus: number;
}

interface RpcRow {
  nm_id: number;
  article: string;
  orders_month: number;
  stock: number;
  in_way_to_client: number;
}

export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) {
    return NextResponse.json({ data: null, error: "Supabase не настроен" }, { status: 500 });
  }

  try {
    const [reportRes, stocksRes] = await Promise.all([
      db.rpc("rnp_report"),
      db.from("wb_stocks").select("warehouse, quantity, in_way_to_client").limit(2000),
    ]);

    if (reportRes.error) throw new Error(reportRes.error.message);

    const rpcRows = (reportRes.data ?? []) as RpcRow[];

    const need = (avgDaily: number, stock: number, inWay: number, horizon: number) =>
      Math.max(0, Math.ceil(avgDaily * horizon - stock - inWay));

    const skus: SupplyRow[] = rpcRows.map((r) => {
      const avgDaily = r.orders_month / 30;
      const stock = Number(r.stock);
      const inWay = Number(r.in_way_to_client);
      return {
        nmId: r.nm_id,
        article: r.article,
        avgDaily,
        stock,
        inWay,
        daysLeft: avgDaily > 0 ? Math.round(stock / avgDaily) : null,
        need30: need(avgDaily, stock, inWay, 30),
        need45: need(avgDaily, stock, inWay, 45),
        need60: need(avgDaily, stock, inWay, 60),
      };
    });

    // сводка по складам
    const whMap = new Map<string, WarehouseSummary>();
    for (const s of stocksRes.data ?? []) {
      const name = (s.warehouse as string) || "—";
      const agg = whMap.get(name) ?? { warehouse: name, quantity: 0, inWay: 0, skus: 0 };
      agg.quantity += Number(s.quantity ?? 0);
      agg.inWay += Number(s.in_way_to_client ?? 0);
      agg.skus += 1;
      whMap.set(name, agg);
    }
    const warehouses = [...whMap.values()].sort((a, b) => b.quantity - a.quantity);

    skus.sort((a, b) => b.need45 - a.need45);

    // --- Контракт inferno-вкладки «Поставки» (top-level) ---
    // Раскладка по складам строится из загруженной «готовой тары» (xlsx) — это отложенный
    // ручной flow (тара/WMS/МойСклад, см. docs/отложено.md). Без тары список SKU пуст,
    // показываем целевые склады с долями по фактическому остатку wb_stocks.
    const totalQty = warehouses.reduce((a, w) => a + w.quantity, 0);
    let acc = 0;
    const whInferno = warehouses.map((w, i) => {
      let pct: number;
      if (i === warehouses.length - 1) pct = Math.max(0, 100 - acc);
      else { pct = totalQty > 0 ? Math.round((w.quantity / totalQty) * 100) : 0; acc += pct; }
      return { name: w.warehouse, pct: pct ? pct + "%" : "" };
    });
    const wbStockTotal = warehouses.reduce((a, w) => a + w.quantity, 0);

    return NextResponse.json({
      data: { skus, warehouses },
      error: null,
      // inferno top-level
      warehouses: whInferno,
      skus: [],
      totals: { wb_stock: wbStockTotal, available: 0, qty: whInferno.map(() => 0) },
      threshold: 30,
      whEcon: [],
      wb_wh: warehouses.length ? { updated_at: null, count: skus.length } : null,
      tara: null,
      restrictions_meta: null,
      wms: null,
      wb_supply_nums: {},
      wms_orders: {},
      coverage: null,
      pallet_liters: 1230,
      vol_known: 0,
      vol_total: skus.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ data: null, error: msg }, { status: 500 });
  }
}
