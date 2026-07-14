export type OzonQualityStatus = "ok" | "warning" | "error";

export const OZON_AD_CACHE_WARNING_HOURS = 2;
export const OZON_AD_CACHE_ERROR_HOURS = 6;

export interface OzonEconomyUnitInput {
  price: number;
  cost: number;
  commission: number;
  logistics: number;
  acquiring: number;
  ad: number;
  tax: number;
}

export interface OzonEconomyQualityRow {
  units: number;
  revenue: number;
  profit: number | null;
  reliability: "estimated" | "missing_cost";
}

export interface OzonSalesAggregateRow {
  orders: number;
  revenue: number;
  previousOrders?: number;
  previousRevenue?: number;
}

export interface OzonSalesSummary {
  orders: number;
  revenue: number;
  previousOrders: number;
  previousRevenue: number;
}

export interface OzonCabinetSourceState {
  cabinet: string;
  available: boolean;
  error?: string | null;
}

export function summarizeOzonSales(rows: OzonSalesAggregateRow[]): OzonSalesSummary {
  return rows.reduce<OzonSalesSummary>(
    (totals, row) => ({
      orders: totals.orders + Number(row.orders || 0),
      revenue: totals.revenue + Number(row.revenue || 0),
      previousOrders: totals.previousOrders + Number(row.previousOrders || 0),
      previousRevenue: totals.previousRevenue + Number(row.previousRevenue || 0),
    }),
    { orders: 0, revenue: 0, previousOrders: 0, previousRevenue: 0 },
  );
}

export function requireCompleteOzonSalesSnapshot(states: OzonCabinetSourceState[]) {
  const unavailable = states.filter((state) => !state.available);
  if (!unavailable.length) return;

  const details = unavailable
    .map((state) => `${state.cabinet}${state.error ? ` (${state.error})` : ""}`)
    .join(", ");
  throw new Error(`Неполный снимок продаж Ozon: ${details}`);
}

export function calculateOzonEconomyUnit(input: OzonEconomyUnitInput): {
  profit: number | null;
  margin: number | null;
  reliability: "estimated" | "missing_cost";
} {
  if (!Number.isFinite(input.cost) || input.cost <= 0) {
    return { profit: null, margin: null, reliability: "missing_cost" };
  }

  const profit = input.price
    - input.cost
    - input.commission
    - input.logistics
    - input.acquiring
    - input.ad
    - input.tax;

  return {
    profit,
    margin: input.price > 0 ? (profit / input.price) * 100 : null,
    reliability: "estimated",
  };
}

export function summarizeOzonEconomy(rows: OzonEconomyQualityRow[]) {
  const known = rows.filter((row) => row.reliability === "estimated" && row.profit !== null);
  const totalRevenue = rows.reduce((total, row) => total + Number(row.revenue || 0), 0);
  const knownCostRevenue = known.reduce((total, row) => total + Number(row.revenue || 0), 0);

  return {
    calculatedProfit: Math.round(known.reduce(
      (total, row) => total + Number(row.profit ?? 0) * Number(row.units || 0),
      0,
    )),
    missingCost: rows.length - known.length,
    knownCostSku: known.length,
    sku: rows.length,
    knownCostRevenue: Math.round(knownCostRevenue),
    revenueCoveragePct: totalRevenue > 0
      ? Math.round((knownCostRevenue / totalRevenue) * 1_000) / 10
      : 0,
  };
}

export function ozonAdCacheStatus(
  performanceConfigured: boolean,
  ageHours: number | null,
): OzonQualityStatus {
  if (!performanceConfigured || ageHours === null) return "warning";
  if (ageHours > OZON_AD_CACHE_ERROR_HOURS) return "error";
  if (ageHours > OZON_AD_CACHE_WARNING_HOURS) return "warning";
  return "ok";
}

export function ozonSyncStatus(latestSync: { status?: unknown } | null): OzonQualityStatus {
  if (!latestSync) return "warning";
  return latestSync.status === "ok" ? "ok" : "error";
}

export function summarizeOzonHealth(
  cabinetStatuses: OzonQualityStatus[],
  latestSync: { status?: unknown } | null,
) {
  const sync = ozonSyncStatus(latestSync);
  return {
    healthy: cabinetStatuses.filter((status) => status === "ok").length,
    warnings: cabinetStatuses.filter((status) => status === "warning").length + (sync === "warning" ? 1 : 0),
    errors: cabinetStatuses.filter((status) => status === "error").length + (sync === "error" ? 1 : 0),
    sync,
  };
}
