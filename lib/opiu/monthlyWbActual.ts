import type { OpiuReport } from "./buildReport";

interface MonthlyWbSource {
  report: OpiuReport;
  timestamp: string;
  meta: { salesRows: number };
}

function requiredTotal(report: OpiuReport, rowId: string): number {
  const row = report.rows.find((item) => item.id === rowId);
  const value = row?.values.at(-1);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Финансовый отчёт WB не содержит строку «${rowId}»`);
  }
  return Math.round(value);
}

function optionalTotal(report: OpiuReport, rowId: string): number {
  const value = report.rows.find((item) => item.id === rowId)?.values.at(-1);
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
}

/**
 * Перекладывает уже сверенный финансовый отчёт WB в статьи месячного ОПиУ.
 * Расходы остаются положительными: модель ОПиУ вычитает их на уровне итогов.
 */
export function monthlyWbActualFromOpiu(source: MonthlyWbSource) {
  const report = source.report;
  const revenueBeforeSpp = requiredTotal(report, "revenue_without_spp");
  const revenue = requiredTotal(report, "revenue");
  const commission = requiredTotal(report, "commission");
  const logistics = requiredTotal(report, "logistics");
  const cogs = requiredTotal(report, "cogs");
  const packaging = requiredTotal(report, "packaging");
  const storage = requiredTotal(report, "warehouse");
  const penalty = requiredTotal(report, "penalties");
  const ad = requiredTotal(report, "ads");
  const other = ["other", "jem", "withdraw_now", "transit", "acceptance"]
    .reduce((sum, id) => sum + requiredTotal(report, id), 0);
  const profit = requiredTotal(report, "gross");
  const margin = optionalTotal(report, "gross_pct");
  const warnings: string[] = [];
  if (report.missingCostArticles.length) {
    warnings.push(`Не задана себестоимость для ${report.missingCostArticles.length} артикул(ов)`);
  }

  return {
    revenue_before_spp: revenueBeforeSpp,
    coinvest: optionalTotal(report, "loyalty_comp"),
    revenue,
    commission,
    logistics,
    storage,
    penalty,
    acquiring: 0,
    ad,
    other,
    cogs,
    packaging,
    tax: 0,
    profit,
    margin,
    units: 0,
    payout: optionalTotal(report, "for_pay"),
    returns: 0,
    source: "wb_financial_report" as const,
    updatedAt: source.timestamp,
    rowsCount: source.meta.salesRows,
    warnings,
  };
}
