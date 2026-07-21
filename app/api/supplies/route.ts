import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveCabinetSelection } from "@/lib/cabinetGroups";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { requestAllowedNmIds, requestAllowsNm } from "@/lib/wb/requestProductScope";
import { loadCabinetPimRowsHourly } from "@/lib/wb/cards";
import { buildSupplyVolumeCoverage } from "@/lib/supplies/volumeCoverage";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { loadRnpReportRows } from "@/lib/rnp/rpcLoaders";

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

// Полный постраничный фетч wb_stocks для каталога и складской сводки.
// members (комбо-группа) → .in(), single → .eq(), оба null → без фильтра (все кабинеты).
async function fetchAllStocks(db: SupabaseClient, single: string | null, members: string[] | null) {
  type StockRow = { nm_id: number; cabinet_id: string | null; warehouse: string; quantity: number | null; in_way_to_client: number | null; in_way_from_client: number | null };
  return loadAllSupabasePages<StockRow>((from, to) => {
    let q = db.from("wb_stocks")
      .select("nm_id, cabinet_id, warehouse, quantity, in_way_to_client, in_way_from_client")
      .order("warehouse", { ascending: true })
      .order("nm_id", { ascending: true })
      .range(from, to);
    if (members) q = q.in("cabinet_id", members);
    else if (single) q = q.eq("cabinet_id", single);
    return q;
  }, { label: "Остатки WB" });
}

// rnp_report принимает один p_cabinet — для группы вызываем по каждому участнику
// и суммируем аддитивные поля по nm_id (заказы/остаток/в пути — простые суммы,
// без пересчёта долей/ставок, поэтому merge безопасен).
async function fetchRpcRows(db: SupabaseClient, single: string | null, members: string[] | null): Promise<RpcRow[]> {
  if (!members) {
    const allowedNmIds = await requestAllowedNmIds(single);
    return loadRnpReportRows<RpcRow>(db, single, {
      allowedNmIds,
      label: "Поставки WB: товары",
    });
  }
  const results = await Promise.all(members.map(async (member) => {
    const allowedNmIds = await requestAllowedNmIds(member);
    return {
      rows: await loadRnpReportRows<RpcRow>(db, member, {
        allowedNmIds,
        label: "Поставки WB: товары участника группы",
      }),
      allowedNmIds,
    };
  }));
  const merged = new Map<number, RpcRow>();
  for (const { rows, allowedNmIds } of results) {
    for (const r of rows) {
      if (!requestAllowsNm(allowedNmIds, r.nm_id)) continue;
      const cur = merged.get(r.nm_id);
      if (!cur) { merged.set(r.nm_id, { ...r }); continue; }
      cur.orders_month += r.orders_month;
      cur.stock += r.stock;
      cur.in_way_to_client += r.in_way_to_client;
    }
  }
  return [...merged.values()];
}

export async function GET(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) {
    return NextResponse.json({ data: null, error: "Supabase не настроен" }, { status: 500 });
  }
  const { single: p_cabinet, members } = await resolveCabinetSelection(new URL(req.url).searchParams.get("cabinet"));
  const accessAllowed = members
    ? (await Promise.all(members.map((member) => hasCabinetAccess(member)))).every(Boolean)
    : await hasCabinetAccess(p_cabinet);
  if (!accessAllowed) {
    return NextResponse.json({ data: null, error: "Нет доступа к кабинету" }, { status: 403 });
  }

  try {
    const scopeCabinets = members ?? (p_cabinet ? [p_cabinet] : []);
    const scopeEntries = await Promise.all(scopeCabinets.map(async (cabinet) => [cabinet, await requestAllowedNmIds(cabinet)] as const));
    const scopeByCabinet = new Map(scopeEntries);
    const stockAllowed = (row: { nm_id?: unknown; cabinet_id?: unknown }) => {
      const rowCabinet = String(row.cabinet_id ?? "");
      const allowedNmIds = scopeByCabinet.get(rowCabinet);
      return allowedNmIds === undefined ? true : requestAllowsNm(allowedNmIds, row.nm_id);
    };
    const pimRowsPromise = (members
      ? Promise.all(members.map((member) => loadCabinetPimRowsHourly(member))).then((rows) => rows.flat())
      : loadCabinetPimRowsHourly(p_cabinet))
      .then((rows) => ({ rows, error: null as string | null }))
      .catch((error: unknown) => ({
        rows: [],
        error: error instanceof Error ? error.message : "Габариты WB не загружены",
      }));
    const [rpcRows, allStockRowsRaw, costsRes, pimSnapshot] = await Promise.all([
      fetchRpcRows(db, p_cabinet, members),
      fetchAllStocks(db, p_cabinet, members),
      db.from("product_costs").select("article, name"),
      pimRowsPromise,
    ]);
    if (costsRes.error) throw new Error(costsRes.error.message);
    const pimRows = pimSnapshot.rows;
    const allStockRows = allStockRowsRaw.filter(stockAllowed);
    const stockRows = allStockRows;

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
    for (const s of stockRows) {
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
    const volumeCoverage = buildSupplyVolumeCoverage(infernoSkus.map((sku) => sku.nm), pimRows);
    const infernoSkusWithVolume = infernoSkus.map((sku) => ({
      ...sku,
      volume_liters: volumeCoverage.litersByNm.get(sku.nm) ?? null,
    }));

    const totalsQty = whInferno.map((_, i) => infernoSkusWithVolume.reduce((a, s) => a + (s.qty[i] || 0), 0));
    const availableTotal = infernoSkusWithVolume.reduce((a, s) => a + s.available, 0);
    const wbStockTotal = warehouses.reduce((a, w) => a + w.quantity, 0);

    return NextResponse.json({
      data: { skus, warehouses, catalog },
      error: null,
      // inferno top-level
      warehouses: whInferno,
      skus: infernoSkusWithVolume,
      totals: { wb_stock: wbStockTotal, available: availableTotal, qty: totalsQty },
      threshold: 30,
      whEcon: [],
      wb_wh: warehouses.length ? { updated_at: null, count: skus.length } : null,
      tara: null,
      restrictions_meta: null,
      wms: null,
      wb_supply_nums: {},
      wms_orders: {},
      coverage: {
        volume: {
          known: volumeCoverage.known,
          total: volumeCoverage.total,
          error: pimSnapshot.error,
        },
      },
      pallet_liters: 1230,
      vol_known: volumeCoverage.known,
      vol_total: volumeCoverage.total,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ data: null, error: msg }, { status: 500 });
  }
}
