import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { cabinetIdFromParam } from "@/lib/rnp/resolveShop";

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

export interface StockCatalogRow {
  nmId: number;
  /** "" — nm_id не встретился в rnp_report (нет заказов за 30д окно) */
  article: string;
  name: string | null;
  quantity: number;
  inWayToClient: number;
  inWayFromClient: number;
  daysLeft: number | null;
  warehouseCount: number;
  topWarehouses: { warehouse: string; quantity: number }[];
}

interface RpcRow {
  nm_id: number;
  article: string;
  orders_month: number;
  stock: number;
  in_way_to_client: number;
}

// Полный (не усечённый .limit(2000)) постраничный фетч wb_stocks — отдельно от
// stockQ ниже, чтобы не менять числа, которыми уже питается warehouses/whInferno/splitNeed.
async function fetchAllStocks(db: SupabaseClient, p_cabinet: string | null) {
  const rows: { nm_id: number; warehouse: string; quantity: number | null; in_way_to_client: number | null; in_way_from_client: number | null }[] = [];
  for (let page = 0; page < 30; page++) {
    let q = db.from("wb_stocks")
      .select("nm_id, warehouse, quantity, in_way_to_client, in_way_from_client")
      .range(page * 1000, page * 1000 + 999);
    if (p_cabinet) q = q.eq("cabinet_id", p_cabinet);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...(data as typeof rows));
    if (data.length < 1000) break;
  }
  return rows;
}

export async function GET(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) {
    return NextResponse.json({ data: null, error: "Supabase не настроен" }, { status: 500 });
  }
  const p_cabinet = cabinetIdFromParam(new URL(req.url).searchParams.get("cabinet"));

  try {
    let stockQ = db.from("wb_stocks").select("warehouse, quantity, in_way_to_client").limit(2000);
    if (p_cabinet) stockQ = stockQ.eq("cabinet_id", p_cabinet);
    const [reportRes, stocksRes, allStockRows, costsRes] = await Promise.all([
      db.rpc("rnp_report", { p_cabinet }),
      stockQ,
      fetchAllStocks(db, p_cabinet),
      db.from("product_costs").select("article, name"),
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

    // мастер-каталог остатков — полный список SKU (не только те, что нужно дозаказать)
    const nameByArticle = new Map((costsRes.data ?? []).map((c) => [c.article as string, c.name as string | null]));
    const daysLeftByNm = new Map(skus.map((s) => [s.nmId, s.daysLeft]));
    const articleByNm = new Map(skus.map((s) => [s.nmId, s.article]));

    const byNm = new Map<number, { quantity: number; toClient: number; fromClient: number; wh: Map<string, number> }>();
    for (const s of allStockRows) {
      const e = byNm.get(s.nm_id) ?? { quantity: 0, toClient: 0, fromClient: 0, wh: new Map<string, number>() };
      const qty = Number(s.quantity ?? 0);
      e.quantity += qty;
      e.toClient += Number(s.in_way_to_client ?? 0);
      e.fromClient += Number(s.in_way_from_client ?? 0);
      if (qty > 0) e.wh.set(s.warehouse, (e.wh.get(s.warehouse) ?? 0) + qty);
      byNm.set(s.nm_id, e);
    }

    const catalog: StockCatalogRow[] = [...byNm.entries()].map(([nmId, e]) => {
      const article = articleByNm.get(nmId) || "";
      const top = [...e.wh.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([warehouse, quantity]) => ({ warehouse, quantity }));
      return {
        nmId, article,
        name: article ? (nameByArticle.get(article) ?? null) : null,
        quantity: e.quantity, inWayToClient: e.toClient, inWayFromClient: e.fromClient,
        daysLeft: daysLeftByNm.get(nmId) ?? null,
        warehouseCount: e.wh.size, topWarehouses: top,
      };
    }).sort((a, b) => b.quantity - a.quantity);

    // --- Контракт inferno-вкладки «Поставки» (top-level) ---
    // Юрин дизайн раскладывает «готовую тару» (xlsx). Тара/WMS — отложено (docs/отложено.md),
    // поэтому показываем РЕАЛЬНУЮ рекомендованную раскладку: потребность к поставке (need45)
    // каждого SKU, разнесённую по топ целевым складам в их долях.
    const TOP_WH = 8;
    const topWh = warehouses.slice(0, TOP_WH);
    const topTotal = topWh.reduce((a, w) => a + w.quantity, 0) || 1;
    let acc = 0;
    const whPct = topWh.map((w, i) => {
      const p = i === topWh.length - 1 ? Math.max(0, 100 - acc) : Math.round((w.quantity / topTotal) * 100);
      if (i < topWh.length - 1) acc += p;
      return p;
    });
    const whInferno = topWh.map((w, i) => ({ name: w.warehouse, pct: whPct[i] ? whPct[i] + "%" : "" }));

    // раскладка потребности по складам
    const splitNeed = (total: number) => {
      const q = whPct.map((p) => Math.round((total * p) / 100));
      const diff = total - q.reduce((a, b) => a + b, 0);
      if (q.length) q[0] += diff; // корректируем остаток на первый склад
      return q;
    };
    const infernoSkus = skus
      .filter((s) => s.need45 > 0)
      .map((s) => {
        const qty = splitNeed(s.need45);
        return {
          nm: s.nmId,
          art: s.article || String(s.nmId),
          shk: "",
          wb_stock: s.stock,
          available: s.need45,
          qty,
          excl: [] as number[],
          wb_wh: null,
        };
      });

    const totalsQty = whInferno.map((_, i) => infernoSkus.reduce((a, s) => a + (s.qty[i] || 0), 0));
    const availableTotal = infernoSkus.reduce((a, s) => a + s.available, 0);
    const wbStockTotal = warehouses.reduce((a, w) => a + w.quantity, 0);

    return NextResponse.json({
      data: { skus, warehouses, catalog },
      error: null,
      // inferno top-level
      warehouses: whInferno,
      skus: infernoSkus,
      totals: { wb_stock: wbStockTotal, available: availableTotal, qty: totalsQty },
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
