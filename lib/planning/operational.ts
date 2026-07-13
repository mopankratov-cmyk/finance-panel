export interface OperationalPlanningInput {
  orders: number[];
  skuOrders: Record<string, number[]>;
  stocks: number[];
}

export interface OperationalPlanningSummary {
  ordersByMonth: number[];
  skuUnitsByMonth: number[];
  activeSkuByMonth: number[];
  annualOrders: number;
  annualSkuUnits: number;
  plannedSku: number;
  stock: number;
}

const value = (input: unknown) => {
  const parsed = Number(input ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export function summarizeOperationalPlanning(input: OperationalPlanningInput): OperationalPlanningSummary {
  const ordersByMonth = Array.from({ length: 12 }, (_, month) => value(input.orders[month]));
  const skuRows = Object.values(input.skuOrders);
  const skuUnitsByMonth = Array.from({ length: 12 }, (_, month) => skuRows.reduce((sum, row) => sum + value(row[month]), 0));
  const activeSkuByMonth = Array.from({ length: 12 }, (_, month) => skuRows.filter((row) => value(row[month]) > 0).length);
  return {
    ordersByMonth,
    skuUnitsByMonth,
    activeSkuByMonth,
    annualOrders: ordersByMonth.reduce((sum, month) => sum + month, 0),
    annualSkuUnits: skuUnitsByMonth.reduce((sum, month) => sum + month, 0),
    plannedSku: skuRows.filter((row) => row.some((month) => value(month) > 0)).length,
    stock: input.stocks.reduce((sum, item) => sum + value(item), 0),
  };
}
