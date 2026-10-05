import assert from "node:assert/strict";
import test from "node:test";
import type { WbReportRow } from "@/lib/wb/types";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

const [metrics, build, taxes, sheet] = await Promise.all([
  import("./metrics"),
  import("./buildReport"),
  import("./weeklyTaxes"),
  import("./googleSheetExport"),
]);

const week = { weekStart: "2026-09-14", rangeFrom: "2026-09-14", rangeTo: "2026-09-20", label: "14–20 сен." };
const noCosts = metrics.buildCostLookup([]);

let nextRrd = 1;
const deduction = (bonus: string, amount: number) => ({
  rrd_id: nextRrd++,
  rr_dt: "2026-09-14",
  sale_dt: "2026-09-14",
  nm_id: 0,
  supplier_oper_name: "Удержание",
  bonus_type_name: bonus,
  deduction: amount,
}) as WbReportRow;

const PRINCIPAL = "Перевод на баланс заёмщика для оплаты основного долга по кредиту 2026022600069 от 2026-02-26";
const INTEREST = "Перевод на баланс заёмщика для оплаты процентов по кредиту 2026022600069 от 2026-02-26";
const COMMISSION = "Перевод на баланс заёмщика для оплаты комиссии по кредиту 2026022600069 от 2026-02-26";
const PENALTY = "Перевод на баланс заёмщика для оплаты пени по кредиту 2026022600069 от 2026-02-26";

test("перевод на баланс заёмщика делится на тело кредита и проценты, пени отдельно", () => {
  const principal = deduction(PRINCIPAL, 24_414.13);
  const interest = deduction(INTEREST, 12_885.13);
  const commission = deduction(COMMISSION, 100);
  const penalty = deduction(PENALTY, 50);
  const ads = deduction("Оказание услуг «WB Продвижение», документ №315984416", 464_939);

  assert.equal(metrics.loanPrincipalRub(principal), 24_414.13);
  assert.equal(metrics.loanInterestRub(principal), 0);
  assert.equal(metrics.loanInterestRub(interest), 12_885.13);
  assert.equal(metrics.loanPrincipalRub(interest), 0);
  assert.equal(metrics.loanInterestRub(commission), 100, "комиссия по кредиту — расход, идёт с процентами");
  assert.equal(metrics.penaltyLoanRub(penalty), 50);
  assert.equal(metrics.loanTransferRub(penalty), 0, "пени не входят ни в тело, ни в проценты");
  for (const fn of [metrics.loanPrincipalRub, metrics.loanInterestRub, metrics.loanTransferRub, metrics.penaltyLoanRub]) {
    assert.equal(fn(ads), 0, "рекламный счёт — не кредит");
  }
});

test("aggregateWeek: тело/проценты/пени = строки недели + общекабинетная доля, «Прочие удержания» их не дублируют", () => {
  const rows = [deduction(PRINCIPAL, 1_000), deduction(INTEREST, 200), deduction(PENALTY, 30)];
  const result = metrics.aggregateWeek(week, rows, [], [], noCosts, 0, { principal: 500, interest: 70, penalty: 5 });

  assert.equal(result.loanPrincipal, 1_500);
  assert.equal(result.loanInterest, 270);
  assert.equal(result.penaltyLoan, 35);
  assert.equal(result.otherDeductions, 0);
  assert.equal(result.tax, 0);
  assert.equal(result.vat, 0);
});

const base = () => metrics.aggregateWeek(week, [], [], [], noCosts, 0);

test("блок «Расходы ниже EBITDA»: Чистая прибыль = Валовая − проценты − пени − налог − НДС, тело не входит", () => {
  const m = {
    ...base(),
    revenueWithoutSpp: 1_000_000,
    adsSpend: 100_000,
    loanInterest: 20_000,
    penaltyLoan: 1_000,
    tax: 5_000,
    vat: 7_000,
    loanPrincipal: 300_000,
  };
  const report = build.buildOpiuReportFromWeekMetrics([week], [m], [], {});
  const ids = report.rows.map((row) => row.id);
  const from = ids.indexOf("gross_pct");

  assert.deepEqual(ids.slice(from + 1), ["sep4", "loan_interest", "penalty_loan", "tax", "vat", "net_profit", "sep5", "loan_principal"]);
  assert.equal(ids.includes("loan_transfer"), false);
  const value = (id: string) => report.rows.find((row) => row.id === id)!.values;
  assert.deepEqual(value("gross"), [900_000, 900_000]);
  assert.deepEqual(value("net_profit"), [867_000, 867_000]);
  assert.deepEqual(value("loan_principal"), [300_000, 300_000]);
  assert.deepEqual(value("loan_interest"), [20_000, 20_000]);
});

test("без налоговых настроек Налог, НДС и Чистая прибыль не считаются — «—», а не нули", () => {
  const m = { ...base(), revenueWithoutSpp: 1_000_000, loanInterest: 20_000, tax: 5_000, vat: 7_000 };
  const report = build.buildOpiuReportFromWeekMetrics([week], [m], [], {}, ["Оптима: налоговый режим, режим НДС"]);
  const value = (id: string) => report.rows.find((row) => row.id === id)!.values;

  assert.deepEqual(value("tax"), [null, null]);
  assert.deepEqual(value("vat"), [null, null]);
  assert.deepEqual(value("net_profit"), [null, null]);
  assert.deepEqual(value("loan_interest"), [20_000, 20_000], "проценты от настроек не зависят");
  assert.deepEqual(report.taxSettingGaps, ["Оптима: налоговый режим, режим НДС"]);
});

test("налог и НДС недели — по настройкам компании, как в месячном ОПиУ", () => {
  const filippov = { id: "1", name: "ИП Филиппов", groupName: "Филиппов", taxSystem: "usn_income" as const, vatMode: "5" as const, taxRate: 1, taxAdditionalRate: 1 };
  const income = { ...base(), revenue: 1_050_000 };
  assert.deepEqual(taxes.weeklyTaxAmounts(income, filippov), { tax: 21_000, vat: 50_000 });

  const pankratov = { id: "2", name: "ИП Панкратов", groupName: "", taxSystem: "usn_income_expense" as const, vatMode: "22" as const, taxRate: 15, taxAdditionalRate: null };
  const profit = { ...base(), revenue: 1_220_000, revenueWithoutSpp: 1_000_000 };
  assert.deepEqual(taxes.weeklyTaxAmounts(profit, pankratov), { tax: 150_000, vat: 220_000 }, "«Доходы−расходы»: налог от валовой прибыли");

  const [taxed] = taxes.withWeeklyTaxes([income], filippov);
  assert.equal(taxed!.tax, 21_000);
  assert.equal(taxed!.vat, 50_000);
  assert.equal(taxes.withWeeklyTaxes([income], undefined)[0], income, "без компании метрики не меняются");
});

test("пробелы налоговых настроек называют юрлицо бренда и что не заполнено", () => {
  const norvia = { id: "norvia", entity: "Retail Family" };
  assert.deepEqual(taxes.brandTaxGaps(norvia, undefined), ["ИП Филиппов: компания не найдена в разделе «Компании»"]);
  assert.deepEqual(taxes.brandTaxGaps(norvia, { id: "1", name: "ИП Филиппов", groupName: "", taxSystem: null, vatMode: null }), ["ИП Филиппов: налоговый режим, режим НДС"]);
  assert.deepEqual(taxes.brandTaxGaps(norvia, { id: "1", name: "ИП Филиппов", groupName: "", taxSystem: "usn_income", vatMode: "5", taxRate: 1, taxAdditionalRate: 1 }), []);
});

test("выгрузка в Google: заголовок «Расходы ниже EBITDA» стоит один раз и прямо перед «Проценты по кредиту»", () => {
  const m = { ...base(), revenueWithoutSpp: 1_000, loanInterest: 10 };
  const report = build.buildOpiuReportFromWeekMetrics([week], [m], [], {});
  const payload = sheet.buildOpiuSheetPayload(report, { brandLabel: "Norvia", periodLabel: "14–20 сен.", generatedAt: "сейчас" });
  const labels = payload.rows.map((row) => row[0]);
  const header = labels.indexOf("Расходы ниже EBITDA");

  assert.ok(header >= 0);
  assert.equal(labels.filter((label) => label === "Расходы ниже EBITDA").length, 1);
  assert.equal(labels[header + 1], "Проценты по кредиту");
});
