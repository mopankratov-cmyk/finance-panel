import { NextRequest, NextResponse } from "next/server";
import { valueMarketplaceStocks, moscowMonthSnapshot, type MarketplaceStockInput, type MarketplaceUnitCost, type ValuedMarketplaceStock } from "@/lib/finance/monthlyMarketplaceStock";
import { ozonStocks } from "@/lib/ozon/api";
import { getOzonCabinetScope } from "@/lib/ozon/cabinet";
import { allowsProduct } from "@/lib/wb/productScope";
import { fetchWbCardPages } from "@/lib/wb/cardPagination";
import { fetchWarehouseRemains, remainsToStockRows } from "@/lib/wb/remainsApi";
import { isWbWarehouse } from "@/lib/wb/realStock";
import { getWbSyncTargets, groupWbStatisticsTargets } from "@/lib/sync/cabinets";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const maxDuration = 300;

type SourceKind = "fulfillment" | "wb" | "ozon" | "supplier_transit";
type CostRow = { article: string; cost_rub: number | null; warehouse_expenses: number | null; organization_id?: string | null };
type CabinetMeta = { id: string; name: string; organization_id: string | null };
type FulfillmentRow = { legal_entity_id: string; warehouse_id: string; variant_id: string; article: string; name: string; size_label: string; qty: number; amount: number; unit_cost: number };

const sourceKey = (kind: SourceKind, id = "all") => `${kind}:${id}`;
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

async function loadCosts(): Promise<CostRow[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  try {
    return await loadAllSupabasePages<CostRow>((from, to) => db.from("product_costs")
      .select("article,cost_rub,warehouse_expenses,organization_id").order("article").range(from, to),
    { label: "Себестоимость месячного остатка", maxPages: 100 });
  } catch (error) {
    if (!/organization_id|schema cache|column/i.test(error instanceof Error ? error.message : String(error))) throw error;
    return loadAllSupabasePages<CostRow>((from, to) => db.from("product_costs")
      .select("article,cost_rub,warehouse_expenses").order("article").range(from, to),
    { label: "Себестоимость месячного остатка", maxPages: 100 });
  }
}

function costsForOrganization(rows: readonly CostRow[], organizationId: string | null): MarketplaceUnitCost[] {
  const tenantColumnAvailable = rows.some((row) => Object.prototype.hasOwnProperty.call(row, "organization_id"));
  return rows
    .filter((row) => !tenantColumnAvailable || row.organization_id === organizationId)
    .map((row) => ({ article: row.article, costRub: Number(row.cost_rub ?? 0), packagingRub: Number(row.warehouse_expenses ?? 0) }));
}

async function saveSource(input: {
  month: string;
  capturedAt: string;
  sourceKind: SourceKind;
  sourceLabel: string;
  lines: ValuedMarketplaceStock[];
  marketplace?: "wb" | "ozon";
  cabinet?: CabinetMeta | null;
  warning?: string | null;
}) {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase не настроен");
  const key = sourceKey(input.sourceKind, input.cabinet?.id || "all");
  const missingCostCount = input.lines.filter((row) => row.totalValue === null).length;
  const status = missingCostCount > 0 || input.warning ? "partial" : "ok";
  const totalValue = missingCostCount > 0 ? null : round2(input.lines.reduce((sum, row) => sum + (row.totalValue ?? 0), 0));
  const run = {
    snapshot_month: input.month,
    source_key: key,
    source_kind: input.sourceKind,
    source_label: input.sourceLabel,
    marketplace: input.marketplace ?? null,
    cabinet_id: input.cabinet?.id || null,
    cabinet_name: input.cabinet?.name ?? null,
    organization_id: input.cabinet?.organization_id ?? null,
    status,
    rows_count: input.lines.length,
    missing_cost_count: missingCostCount,
    total_quantity: input.lines.reduce((sum, row) => sum + row.quantity, 0),
    total_value: totalValue,
    captured_at: input.capturedAt,
    error: [input.warning, missingCostCount ? `${missingCostCount} позиций без себестоимости` : null].filter(Boolean).join("; ") || null,
  };
  const prepared = await db.from("balance_marketplace_stock_runs").upsert(run, { onConflict: "snapshot_month,source_key" });
  if (prepared.error) throw new Error(prepared.error.message);
  const removed = await db.from("balance_marketplace_stock_lines").delete().eq("snapshot_month", input.month).eq("source_key", key);
  if (removed.error) throw new Error(removed.error.message);
  const lines = input.lines.map((row) => ({
    snapshot_month: input.month,
    source_key: key,
    source_kind: input.sourceKind,
    line_key: row.lineKey,
    marketplace: input.marketplace ?? null,
    cabinet_id: input.cabinet?.id || null,
    organization_id: input.cabinet?.organization_id ?? null,
    article: row.article,
    product_name: row.name,
    location_name: row.locationName,
    reference: row.reference,
    quantity: row.quantity,
    cost_rub: row.costRub,
    packaging_rub: row.packagingRub,
    unit_value: row.unitValue,
    total_value: row.totalValue,
    captured_at: input.capturedAt,
  }));
  const error = await chunkedUpsert("balance_marketplace_stock_lines", lines, "snapshot_month,source_key,line_key");
  if (error) throw new Error(error);
  return { rows: input.lines.length };
}

async function fulfillmentLines(): Promise<ValuedMarketplaceStock[]> {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase не настроен");
  const [stocks, warehouses] = await Promise.all([
    loadAllSupabasePages<FulfillmentRow>((from, to) => db.from("stock_balances")
      .select("legal_entity_id,warehouse_id,variant_id,article,name,size_label,qty,amount,unit_cost")
      .gt("qty", 0).order("article").range(from, to), { label: "Остатки фулфилмента", maxPages: 100 }),
    db.from("warehouses").select("id,name,kind"),
  ]);
  if (warehouses.error) throw new Error(warehouses.error.message);
  const warehouseById = new Map((warehouses.data ?? []).map((row) => [String(row.id), { name: String(row.name), kind: String(row.kind ?? "own") }]));
  return stocks.flatMap((row) => {
    const warehouse = warehouseById.get(String(row.warehouse_id));
    if (!warehouse || warehouse.kind === "transit") return [];
    const quantity = Number(row.qty);
    const costRub = Number(row.unit_cost) > 0 ? Number(row.unit_cost) : null;
    return [{
      lineKey: `${row.warehouse_id}:${row.variant_id}`,
      article: String(row.article),
      name: [String(row.name ?? ""), String(row.size_label ?? "")].filter(Boolean).join(" · ") || String(row.article),
      locationName: warehouse.name,
      reference: null,
      quantity,
      costRub,
      packagingRub: costRub === null ? null : 0,
      unitValue: costRub === null ? null : round2(costRub),
      totalValue: costRub === null ? null : round2(Number(row.amount) || costRub * quantity),
    }];
  });
}

async function supplierTransitLines(): Promise<ValuedMarketplaceStock[]> {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase не настроен");
  const result = await db.from("supplier_shipments")
    .select("id,status,supplier_shipment_items(nm_id,article,quantity),purchase_orders!inner(order_number,supplier,currency,exchange_rate,purchase_order_items(nm_id,article,name,unit_price))")
    .in("status", ["shipped", "customs", "arrived"]);
  if (result.error) throw new Error(result.error.message);
  const lines: ValuedMarketplaceStock[] = [];
  for (const raw of result.data ?? []) {
    const row = raw as unknown as Record<string, unknown>;
    const orderRaw = Array.isArray(row.purchase_orders) ? row.purchase_orders[0] : row.purchase_orders;
    const order = (orderRaw ?? {}) as Record<string, unknown>;
    const orderItems = (Array.isArray(order.purchase_order_items) ? order.purchase_order_items : []) as Record<string, unknown>[];
    const byNm = new Map(orderItems.map((item) => [Number(item.nm_id), item]));
    for (const itemRaw of (Array.isArray(row.supplier_shipment_items) ? row.supplier_shipment_items : []) as Record<string, unknown>[]) {
      const nmId = Number(itemRaw.nm_id);
      const orderItem = byNm.get(nmId);
      const quantity = Number(itemRaw.quantity ?? 0);
      const exchangeRate = Number(order.exchange_rate ?? 0);
      const unitPrice = Number(orderItem?.unit_price ?? 0);
      const costRub = unitPrice > 0 && exchangeRate > 0 ? round2(unitPrice * exchangeRate) : null;
      const article = String(itemRaw.article || orderItem?.article || `NM:${nmId}`);
      lines.push({
        lineKey: `${String(row.id)}:${nmId}`,
        article,
        name: String(orderItem?.name || article),
        locationName: "В пути от поставщика",
        reference: [String(order.order_number ?? ""), String(order.supplier ?? ""), String(row.status ?? "")].filter(Boolean).join(" · "),
        quantity,
        costRub,
        packagingRub: costRub === null ? null : 0,
        unitValue: costRub,
        totalValue: costRub === null ? null : round2(costRub * quantity),
      });
    }
  }
  return lines;
}

export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;
  const startedAt = new Date();
  const window = moscowMonthSnapshot(startedAt);
  if (!window.allowed) {
    return NextResponse.json({ ok: true, skipped: true, reason: `Снимок только 1-го числа в 00:01 МСК; сейчас ${window.date} ${window.time}` });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const capturedAt = startedAt.toISOString();
  let affected = 0;
  const errors: string[] = [];
  try {
    const [costRows, cabinetRows, wbTargets, ozonScope] = await Promise.all([
      loadCosts(),
      db.from("wb_cabinets").select("id,name,organization_id").eq("is_active", true),
      getWbSyncTargets(),
      getOzonCabinetScope("all"),
    ]);
    if (cabinetRows.error) throw new Error(cabinetRows.error.message);
    const metaById = new Map(((cabinetRows.data ?? []) as CabinetMeta[]).map((row) => [String(row.id), row]));

    try {
      const lines = await fulfillmentLines();
      affected += (await saveSource({ month: window.month, capturedAt, sourceKind: "fulfillment", sourceLabel: "Фулфилмент", lines })).rows;
    } catch (error) {
      errors.push(`Фулфилмент: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      const lines = await supplierTransitLines();
      affected += (await saveSource({ month: window.month, capturedAt, sourceKind: "supplier_transit", sourceLabel: "В пути от поставщика", lines })).rows;
    } catch (error) {
      errors.push(`В пути от поставщика: ${error instanceof Error ? error.message : String(error)}`);
    }

    for (const group of groupWbStatisticsTargets(wbTargets)) {
      try {
        const [remains, cards] = await Promise.all([
          fetchWarehouseRemains({ token: group[0].statsToken }),
          fetchWbCardPages<Record<string, unknown>>({ token: group[0].contentToken, maxPagesThisRun: 1_000 }),
        ]);
        if (!cards.caughtUp) throw new Error("каталог WB не дочитан целиком");
        const articleByNm = new Map(cards.rows.flatMap((row) => {
          const nmId = Number(row.nmID ?? row.nmId ?? row.nm_id);
          const article = String(row.supplierArticle ?? row.vendorCode ?? "").trim();
          return Number.isInteger(nmId) && nmId > 0 && article ? [[nmId, article] as const] : [];
        }));
        for (const target of group) {
          const byNm = new Map<number, number>();
          for (const row of remainsToStockRows(remains.filter((item) => allowsProduct(target.productScope, item.nmId)))) {
            if (!isWbWarehouse(row.warehouse)) continue;
            const quantity = Number(row.quantity ?? 0);
            if (quantity > 0) byNm.set(row.nm_id, (byNm.get(row.nm_id) ?? 0) + quantity);
          }
          const cabinet = target.cabinetId ? metaById.get(target.cabinetId) : null;
          const stocks: MarketplaceStockInput[] = [...byNm].map(([nmId, quantity]) => ({ article: articleByNm.get(nmId) ?? `WB:${nmId}`, quantity, lineKey: String(nmId), locationName: `Склад WB · ${cabinet?.name ?? target.name}` }));
          const lines = valueMarketplaceStocks(stocks, costsForOrganization(costRows, cabinet?.organization_id ?? null));
          affected += (await saveSource({
            month: window.month, capturedAt, sourceKind: "wb", sourceLabel: `Склад WB · ${cabinet?.name ?? target.name}`,
            marketplace: "wb", cabinet: cabinet ?? { id: target.cabinetId ?? "", name: target.name, organization_id: null }, lines,
          })).rows;
        }
      } catch (error) {
        errors.push(`WB ${group.map((item) => item.name).join(", ")}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (ozonScope.ok) {
      for (const cabinet of ozonScope.scope.cabinets) {
        try {
          const warehouses = await ozonStocks(cabinet.creds, { fresh: true });
          if (!warehouses.ok) throw new Error(warehouses.error);
          const meta = metaById.get(cabinet.id) ?? { id: cabinet.id, name: cabinet.name, organization_id: null };
          const stocks = warehouses.rows.map((row) => ({ article: row.article, name: row.name, quantity: row.free + row.reserved, lineKey: `${row.article}:${row.warehouse}`, locationName: `Склад Ozon · ${cabinet.name}${row.warehouse ? ` · ${row.warehouse}` : ""}` }));
          const lines = valueMarketplaceStocks(stocks, costsForOrganization(costRows, meta.organization_id));
          affected += (await saveSource({
            month: window.month, capturedAt, sourceKind: "ozon", sourceLabel: `Склад Ozon · ${cabinet.name}`,
            marketplace: "ozon", cabinet: meta, lines,
          })).rows;
        } catch (error) {
          errors.push(`Ozon ${cabinet.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } else {
      errors.push(`Ozon: ${ozonScope.error}`);
    }

    const status = errors.length ? "partial" : "ok";
    await writeSyncLog("balance-monthly-stock", status, affected, errors.join("; ") || null, startedAt);
    return NextResponse.json({ ok: errors.length === 0, month: window.month, capturedAt, rows: affected, errors }, { status: errors.length ? 207 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось собрать месячный остаток";
    await writeSyncLog("balance-monthly-stock", "error", affected, message, startedAt);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
