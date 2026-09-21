import { companyTaxTotalRate } from "@/lib/finance/companyTax";
import type { OpiuCompanyOption } from "./companyScope";
import type { MonthlySharedFact } from "./monthlyFacts";

interface MonthlyTaxFactInput {
  company?: OpiuCompanyOption;
  /** Налоговая база из отчётов МП: WB после СПП + фактическая выручка Ozon. */
  marketplaceTaxBase: number;
  ebitda: number;
  shared?: Record<string, MonthlySharedFact>;
}

const money = (value: number) => Math.round(value * 100) / 100;

/**
 * Добавляет расчётные начисления только когда нет подтверждённого факта.
 * НДС помечается частичным: без книги покупок известен исходящий налог, но не
 * окончательная сумма к уплате. Налог на прибыль/УСН также является оценкой до
 * закрытия месяца бухгалтерией.
 */
export function withCalculatedMonthlyTaxes(input: MonthlyTaxFactInput): Record<string, MonthlySharedFact> | undefined {
  const company = input.company;
  const shared = { ...(input.shared ?? {}) };
  if (!company) return input.shared;

  let vat = 0;
  if (!shared.vat && company.vatMode != null) {
    if (company.vatMode === "exempt" || company.vatMode === "0") {
      shared.vat = { amount: 0, status: "complete", note: "Компания работает без начисления НДС" };
    } else {
      const rate = Number(company.vatMode);
      vat = money(Math.max(0, input.marketplaceTaxBase) * rate / (100 + rate));
      shared.vat = {
        amount: vat,
        status: "partial",
        note: `Расчётный исходящий НДС ${rate}% из выручки; входной НДС пока не вычтен`,
      };
    }
  } else {
    vat = shared.vat?.amount ?? 0;
  }

  if (!shared.taxes && company.taxSystem) {
    const rate = companyTaxTotalRate(company.taxRate ?? null, company.taxAdditionalRate ?? null);
    if (rate != null) {
      const incomeBase = Math.max(0, input.marketplaceTaxBase);
      const profitBase = Math.max(0, input.ebitda);
      const incomeSystems = new Set(["usn_income", "ausn_income", "npd"]);
      let amount = incomeSystems.has(company.taxSystem) ? incomeBase * rate / 100 : profitBase * rate / 100;
      if (company.taxSystem === "usn_income_expense") amount = Math.max(amount, incomeBase * 0.01);
      if (company.taxSystem === "ausn_income_expense") amount = Math.max(amount, incomeBase * 0.03);
      shared.taxes = {
        amount: money(amount),
        status: "partial",
        note: `Расчётное начисление по ставке ${rate}% до бухгалтерского закрытия месяца`,
      };
    }
  }

  return shared;
}
