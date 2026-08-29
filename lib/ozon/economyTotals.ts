/**
 * Итоги по видимым строкам юнит-экономики.
 *
 * В таблице каждая колонка — НА ЕДИНИЦУ товара (цена, реклама, налог, прибыль),
 * поэтому «сумма колонки» смысла не имеет: сложить рекламу на штуку по всем
 * товарам — это ни рубли, ни проценты. Итог считается по обороту: расход и
 * прибыль умножаются на проданные единицы.
 *
 * Прибыль и маржа считаются ТОЛЬКО по строкам с себестоимостью — иначе итог
 * молча включал бы товары, у которых прибыль неизвестна, и завышал результат.
 */

export interface OzonEconomyTotalsRow {
  units: number;
  revenue: number;
  ad: number;
  tax: number;
  profit: number | null;
}

export interface OzonEconomyTotals {
  /** Строк в подсчёте. */
  rows: number;
  units: number;
  revenue: number;
  /** Рекламный расход за период: расход на единицу × проданные единицы. */
  ad: number;
  tax: number;
  /** Прибыль по строкам с известной себестоимостью. */
  profit: number;
  /** Сколько строк вошло в прибыль. */
  profitRows: number;
  /** Выручка тех же строк — база маржи. */
  profitRevenue: number;
  /** Маржа по строкам с себестоимостью, %. null — считать не от чего. */
  margin: number | null;
  /** Доля оборота, покрытая себестоимостью, %. */
  revenueCoverage: number | null;
}

export function sumOzonEconomyRows(rows: OzonEconomyTotalsRow[]): OzonEconomyTotals {
  const totals = {
    rows: rows.length,
    units: 0,
    revenue: 0,
    ad: 0,
    tax: 0,
    profit: 0,
    profitRows: 0,
    profitRevenue: 0,
  };

  for (const row of rows) {
    const units = Number(row.units) || 0;
    const revenue = Number(row.revenue) || 0;
    totals.units += units;
    totals.revenue += revenue;
    totals.ad += (Number(row.ad) || 0) * units;
    totals.tax += (Number(row.tax) || 0) * units;
    if (row.profit != null && Number.isFinite(row.profit)) {
      totals.profit += row.profit * units;
      totals.profitRows += 1;
      totals.profitRevenue += revenue;
    }
  }

  const round = (value: number) => Math.round(value);
  return {
    ...totals,
    units: round(totals.units),
    revenue: round(totals.revenue),
    ad: round(totals.ad),
    tax: round(totals.tax),
    profit: round(totals.profit),
    profitRevenue: round(totals.profitRevenue),
    margin: totals.profitRevenue > 0
      ? Math.round((totals.profit / totals.profitRevenue) * 1_000) / 10
      : null,
    revenueCoverage: totals.revenue > 0
      ? Math.round((totals.profitRevenue / totals.revenue) * 1_000) / 10
      : null,
  };
}
