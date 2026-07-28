// «Маржа по артикулам» — та же модель, что и лист «Маржа по артикулам (артикул WB)» в
// эталонном Excel-отчёте, но по живым данным WB API и сгруппированная по nm_id вместо недель.
// Столбцы и порядок расчётов один в один повторяют формулы того листа (см. план фичи).

import type { WbReportRow } from "@/lib/wb/types";
import {
  bonusType,
  cogsForSales,
  docType,
  expenseRub,
  forPayRub,
  num,
  packagingForSales,
  revenueRub,
  type CostLookup,
} from "./metrics";
import type { NmStatByNmRow } from "./fetchNmStats";
import type { PaidStorageRow } from "./fetchPaidStorage";
import type { PaidAcceptanceRow } from "./fetchPaidAcceptance";
import type { IncomeRow } from "./fetchIncomes";

export interface MarginByNmRow {
  nmId: number;
  vendorCode: string;
  ordersQty: number;
  ordersRub: number;
  salesQty: number;
  returnsQty: number;
  refusalsQty: number;
  salesTotalQty: number;
  buyoutPct: number | null;
  salesRub: number;
  returnsRub: number;
  revenueWithoutSpp: number;
  revenueAfterSpp: number;
  forPay: number;
  commission: number;
  commissionPct: number | null;
  deliveriesQty: number;
  logistics: number;
  logisticsPerUnit: number | null;
  penalties: number;
  additionalPayments: number;
  storage: number;
  storagePerUnit: number | null;
  storagePct: number | null;
  acceptance: number;
  acceptancePerUnit: number | null;
  transit: number;
  totalToPay: number;
  cogs: number;
  packaging: number;
  marginalProfit: number;
  marginalPct: number | null;
  tax: number;
  netProfit: number;
  netProfitPerUnit: number | null;
  marginWithTaxPct: number | null;
  adsSpend: number;
  marginExStoragePct: number | null;
}

function pct(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return (numerator / denominator) * 100;
}

function div(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return numerator / denominator;
}

/** Сумма поля по строкам, раздельно по типу документа (Продажа/Возврат) — без сальдо. */
function sumByDocType(rows: WbReportRow[], field: keyof WbReportRow): { sale: number; ret: number } {
  let sale = 0;
  let ret = 0;
  for (const r of rows) {
    const t = docType(r);
    if (t === "sale") sale += num(r[field]);
    else if (t === "return") ret += num(r[field]);
  }
  return { sale, ret };
}

const TRANSIT_MARK = "услуги доставки транзитных поставок";
const INCOME_ID_RE = /поставка\s*№\s*(\d+)/i;

/**
 * Столбец «Транзит»: удержание финотчёта за транзитную доставку поставки (сумма зашита
 * в bonus_type_name вместе с номером поставки) делим пропорционально количеству товара в
 * этой поставке (по данным /api/v1/supplier/incomes) и суммируем по nm_id.
 * Повторяет логику листа «тех лист Транзит» без ручного ввода.
 */
export function computeTransitByNm(sales: WbReportRow[], incomes: IncomeRow[]): Map<number, number> {
  const incomesByIncomeId = new Map<string, IncomeRow[]>();
  for (const inc of incomes) {
    const arr = incomesByIncomeId.get(inc.incomeId) ?? [];
    arr.push(inc);
    incomesByIncomeId.set(inc.incomeId, arr);
  }

  const result = new Map<number, number>();
  for (const row of sales) {
    const bt = bonusType(row);
    if (!bt.includes(TRANSIT_MARK)) continue;
    const amount = expenseRub(row.deduction);
    if (!amount) continue;
    const match = String(row.bonus_type_name ?? "").match(INCOME_ID_RE);
    if (!match) continue;
    const items = incomesByIncomeId.get(match[1]);
    if (!items || items.length === 0) continue;
    const totalQty = items.reduce((s, it) => s + it.quantity, 0);
    if (!totalQty) continue;
    const perUnit = amount / totalQty;
    for (const it of items) {
      result.set(it.nmId, (result.get(it.nmId) ?? 0) + perUnit * it.quantity);
    }
  }
  return result;
}

function zeroRow(nmId: number, vendorCode: string): MarginByNmRow {
  return {
    nmId, vendorCode,
    ordersQty: 0, ordersRub: 0, salesQty: 0, returnsQty: 0, refusalsQty: 0, salesTotalQty: 0,
    buyoutPct: null, salesRub: 0, returnsRub: 0, revenueWithoutSpp: 0, revenueAfterSpp: 0,
    forPay: 0, commission: 0, commissionPct: null, deliveriesQty: 0, logistics: 0,
    logisticsPerUnit: null, penalties: 0, additionalPayments: 0, storage: 0, storagePerUnit: null,
    storagePct: null, acceptance: 0, acceptancePerUnit: null, transit: 0, totalToPay: 0,
    cogs: 0, packaging: 0, marginalProfit: 0, marginalPct: null, tax: 0, netProfit: 0,
    netProfitPerUnit: null, marginWithTaxPct: null, adsSpend: 0, marginExStoragePct: null,
  };
}

export interface MarginByNmInputs {
  from: string;
  to: string;
  sales: WbReportRow[];
  nmStatsByNm: Map<number, NmStatByNmRow>;
  costLookup: CostLookup;
  storageRows: PaidStorageRow[];
  acceptanceRows: PaidAcceptanceRow[];
  incomes: IncomeRow[];
  adSpendByNm: Map<number, number>;
  taxRate: number;
}

export function buildMarginByNm(input: MarginByNmInputs): { rows: MarginByNmRow[]; totals: MarginByNmRow } {
  const { from, to, sales, nmStatsByNm, costLookup, storageRows, acceptanceRows, incomes, adSpendByNm, taxRate } = input;

  const salesByNm = new Map<number, WbReportRow[]>();
  for (const row of sales) {
    const nmId = Number(row.nm_id);
    if (!nmId) continue;
    const arr = salesByNm.get(nmId) ?? [];
    arr.push(row);
    salesByNm.set(nmId, arr);
  }

  const storageByNm = new Map<number, PaidStorageRow[]>();
  for (const r of storageRows) {
    if (r.date < from || r.date > to) continue;
    const arr = storageByNm.get(r.nmId) ?? [];
    arr.push(r);
    storageByNm.set(r.nmId, arr);
  }

  const acceptanceByNm = new Map<number, PaidAcceptanceRow[]>();
  for (const r of acceptanceRows) {
    if (r.date < from || r.date > to) continue;
    const arr = acceptanceByNm.get(r.nmId) ?? [];
    arr.push(r);
    acceptanceByNm.set(r.nmId, arr);
  }

  const transitByNm = computeTransitByNm(sales, incomes);

  const allNmIds = new Set<number>([
    ...salesByNm.keys(),
    ...nmStatsByNm.keys(),
    ...storageByNm.keys(),
    ...acceptanceByNm.keys(),
  ]);

  const rows: MarginByNmRow[] = [];

  for (const nmId of allNmIds) {
    const nmSales = salesByNm.get(nmId) ?? [];
    const nmStat = nmStatsByNm.get(nmId);
    const vendorCode =
      nmSales.find((r) => r.sa_name)?.sa_name?.toString() ?? nmStat?.vendorCode ?? "";

    const ordersQty = nmStat?.ordersCount ?? 0;
    const ordersRub = nmStat?.ordersSumRub ?? 0;

    const qty = sumByDocType(nmSales, "quantity");
    const salesQty = qty.sale;
    const returnsQty = qty.ret;
    const salesTotalQty = salesQty - returnsQty;
    const refusalsQty = nmSales.filter((r) => bonusType(r) === "от клиента при отмене").length;
    const buyoutPct = div(salesTotalQty, ordersQty);

    const priceWithDisc = sumByDocType(nmSales, "retail_price_withdisc_rub");
    const salesRub = priceWithDisc.sale;
    const returnsRub = priceWithDisc.ret;
    const revenueWithoutSpp = salesRub - returnsRub;

    const revenueAfterSpp = nmSales.reduce((s, r) => s + revenueRub(r), 0);
    const forPay = nmSales.reduce((s, r) => s + forPayRub(r), 0);
    const commission = revenueWithoutSpp - forPay;
    const commissionPct = pct(commission, revenueWithoutSpp);

    const deliveriesQty = nmSales.filter((r) => {
      const bt = bonusType(r);
      return bt === "к клиенту при отмене" || bt === "к клиенту при продаже";
    }).length;

    const logistics = nmSales.reduce((s, r) => s + expenseRub(r.delivery_rub), 0);
    const logisticsPerUnit = div(logistics, salesTotalQty);

    const penalties = nmSales.reduce((s, r) => s + expenseRub(r.penalty), 0);
    const additionalPayments = nmSales.reduce((s, r) => s + expenseRub(r.additional_payment), 0);

    const storageForNm = storageByNm.get(nmId) ?? [];
    const storage = storageForNm.reduce((s, r) => s + r.warehousePrice, 0);
    const storageUnits = storageForNm.reduce((s, r) => s + r.barcodesCount, 0);
    const storagePerUnit = div(storage, storageUnits);
    const storagePct = pct(storage, revenueWithoutSpp);

    const acceptanceForNm = acceptanceByNm.get(nmId) ?? [];
    const acceptance = acceptanceForNm.reduce((s, r) => s + r.total, 0);
    const acceptanceUnits = acceptanceForNm.reduce((s, r) => s + r.count, 0);
    const acceptancePerUnit = div(acceptance, acceptanceUnits);

    const transit = transitByNm.get(nmId) ?? 0;

    const totalToPay = revenueWithoutSpp - commission - logistics - penalties - additionalPayments - storage - acceptance - transit;

    const cogs = cogsForSales(nmSales, costLookup);
    const packaging = packagingForSales(nmSales, costLookup);

    const marginalProfit = totalToPay - cogs - packaging;
    const marginalPct = pct(marginalProfit, revenueWithoutSpp);

    const tax = revenueAfterSpp * taxRate;
    const netProfit = marginalProfit - tax;
    const netProfitPerUnit = div(netProfit, salesTotalQty);
    const marginWithTaxPct = pct(netProfit, revenueWithoutSpp);

    const adsSpend = adSpendByNm.get(nmId) ?? 0;

    const marginExStoragePct = pct(
      revenueWithoutSpp - commission - logistics - cogs - packaging,
      revenueWithoutSpp,
    );

    rows.push({
      nmId, vendorCode,
      ordersQty, ordersRub, salesQty, returnsQty, refusalsQty, salesTotalQty,
      buyoutPct, salesRub, returnsRub, revenueWithoutSpp, revenueAfterSpp,
      forPay, commission, commissionPct, deliveriesQty, logistics,
      logisticsPerUnit, penalties, additionalPayments, storage, storagePerUnit,
      storagePct, acceptance, acceptancePerUnit, transit, totalToPay,
      cogs, packaging, marginalProfit, marginalPct, tax, netProfit,
      netProfitPerUnit, marginWithTaxPct, adsSpend, marginExStoragePct,
    });
  }

  rows.sort((a, b) => b.revenueWithoutSpp - a.revenueWithoutSpp);

  const totals = rows.reduce<MarginByNmRow>((acc, r) => {
    acc.ordersQty += r.ordersQty;
    acc.ordersRub += r.ordersRub;
    acc.salesQty += r.salesQty;
    acc.returnsQty += r.returnsQty;
    acc.refusalsQty += r.refusalsQty;
    acc.salesTotalQty += r.salesTotalQty;
    acc.salesRub += r.salesRub;
    acc.returnsRub += r.returnsRub;
    acc.revenueWithoutSpp += r.revenueWithoutSpp;
    acc.revenueAfterSpp += r.revenueAfterSpp;
    acc.forPay += r.forPay;
    acc.commission += r.commission;
    acc.deliveriesQty += r.deliveriesQty;
    acc.logistics += r.logistics;
    acc.penalties += r.penalties;
    acc.additionalPayments += r.additionalPayments;
    acc.storage += r.storage;
    acc.acceptance += r.acceptance;
    acc.transit += r.transit;
    acc.totalToPay += r.totalToPay;
    acc.cogs += r.cogs;
    acc.packaging += r.packaging;
    acc.marginalProfit += r.marginalProfit;
    acc.tax += r.tax;
    acc.netProfit += r.netProfit;
    acc.adsSpend += r.adsSpend;
    return acc;
  }, zeroRow(0, "Итого"));

  totals.buyoutPct = div(totals.salesTotalQty, totals.ordersQty);
  totals.commissionPct = pct(totals.commission, totals.revenueWithoutSpp);
  totals.logisticsPerUnit = div(totals.logistics, totals.salesTotalQty);
  totals.storagePct = pct(totals.storage, totals.revenueWithoutSpp);
  totals.acceptancePerUnit = null;
  totals.storagePerUnit = null;
  totals.marginalPct = pct(totals.marginalProfit, totals.revenueWithoutSpp);
  totals.netProfitPerUnit = div(totals.netProfit, totals.salesTotalQty);
  totals.marginWithTaxPct = pct(totals.netProfit, totals.revenueWithoutSpp);
  totals.marginExStoragePct = pct(
    totals.revenueWithoutSpp - totals.commission - totals.logistics - totals.cogs - totals.packaging,
    totals.revenueWithoutSpp,
  );

  return { rows, totals };
}
