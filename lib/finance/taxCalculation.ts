import type { CompanyTaxSystem, CompanyVatMode } from "./companyTax";

export type VatDocumentStatus = "missing" | "received" | "not_required";
export type VatDeductionStatus = "pending" | "eligible" | "not_eligible";
export type UsnExpenseStatus = "pending" | "included" | "excluded";

export interface ParsedPaymentVat {
  rate: number | null;
  amount: number;
  kind: "explicit" | "calculated" | "without_vat" | "unknown";
}

export interface TaxExpenseInput {
  grossAmount: number;
  vatAmount: number;
  vatDocumentStatus: VatDocumentStatus;
  vatDeductionStatus: VatDeductionStatus;
  usnExpenseStatus: UsnExpenseStatus;
}

export interface TaxPeriodInput {
  taxSystem: CompanyTaxSystem | null;
  taxRate: number | null;
  vatMode: CompanyVatMode | null;
  marketplaceIncomeGross: number;
  /** Часть валовой выручки, относящаяся к периоду после даты начала НДС. */
  vatTaxableIncomeGross?: number;
  /** Точный исходящий НДС по книге продаж; null/undefined — расчёт по единой ставке компании. */
  outputVatConfirmed?: number | null;
  marketplaceExpensesGross: number;
  marketplaceInputVatConfirmed?: number;
  /** Часть подтверждённого НДС, относящаяся именно к расходам, включённым в УСН. */
  marketplaceInputVatInUsnExpenses?: number;
  /** Взносы ИП/работников, которые заявляются для уменьшения УСН или как расход Д-Р. */
  insuranceContributions?: number;
  /** 100 для ИП без работников, 50 при наличии работников, 0 если уменьшение не настроено. */
  insuranceReductionLimitPercent?: number;
  /** Переносимый убыток прошлых лет для УСН Д-Р. */
  priorYearLoss?: number;
  bankExpenses: readonly TaxExpenseInput[];
}

export interface TaxPeriodResult {
  outputVat: number;
  confirmedInputVat: number;
  vatPayable: number;
  usnIncome: number;
  usnExpenses: number;
  usnBase: number;
  usnBeforeReduction: number;
  insuranceContributionsApplied: number;
  usnCalculated: number;
  minimumTaxControl: number;
  vatCarryforward: number;
}

const money = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

function parseMoney(value: string): number | null {
  const normalized = value.replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Банки передают НДС свободным текстом. Явная сумма имеет приоритет; если в
 * назначении есть только ставка, сумма является подсказкой и рассчитывается
 * из общей суммы платежа как НДС, уже включённый в цену.
 */
export function parsePaymentVat(purpose: string, paymentAmount: number): ParsedPaymentVat {
  const text = String(purpose ?? "").replace(/ё/g, "е");
  if (/без\s+ндс|ндс\s+не\s+(?:облагается|предусмотрен)|не\s+облагается\s+ндс/i.test(text)) {
    return { rate: 0, amount: 0, kind: "without_vat" };
  }

  const rateMatch = text.match(/ндс[^\d]{0,16}(0|5|7|10|20|22)\s*%/i)
    ?? text.match(/(?:0|5|7|10|20|22)\s*%[^\d]{0,16}ндс/i);
  const rate = rateMatch ? Number(rateMatch[1] ?? rateMatch[0].match(/\d+/)?.[0]) : null;
  const textAfterRate = rateMatch ? text.slice((rateMatch.index ?? 0) + rateMatch[0].length) : "";
  if (rate != null && rate > 0 && !/\d/.test(textAfterRate)) {
    return { rate, amount: money(Math.abs(paymentAmount) * rate / (100 + rate)), kind: "calculated" };
  }
  const amountPatterns = [
    /(?:в\s*(?:т\.?\s*ч\.?|том\s+числе)\s*)?ндс(?:\s*\(?\s*(?:0|5|7|10|20|22)\s*%\s*\)?)?\s*[:=\-]?\s*([\d\s\u00a0\u202f]+(?:[.,]\d{1,2})?)(?:\s*(?:руб|р\.?))?/i,
    /сумма\s+ндс\s*[:=\-]?\s*([\d\s\u00a0\u202f]+(?:[.,]\d{1,2})?)/i,
  ];
  for (const pattern of amountPatterns) {
    const match = text.match(pattern);
    const explicit = match?.[1] ? parseMoney(match[1]) : null;
    // «НДС 22%» не должно превращаться в явную сумму 22 рублей.
    const rateOnly = explicit != null && rate != null && explicit === rate && /ндс[^\d]{0,16}\d+\s*%/i.test(match?.[0] ?? "");
    if (explicit != null && explicit >= 0 && !rateOnly && !match?.[0].trim().endsWith("%")) {
      return { rate, amount: money(explicit), kind: "explicit" };
    }
  }
  if (rate != null && rate > 0) {
    return {
      rate,
      amount: money(Math.abs(paymentAmount) * rate / (100 + rate)),
      kind: "calculated",
    };
  }
  return { rate: null, amount: 0, kind: "unknown" };
}

export function vatAllowsInputDeduction(vatMode: CompanyVatMode | null): boolean {
  return vatMode === "10" || vatMode === "22";
}

export function includedVat(grossAmount: number, vatMode: CompanyVatMode | null): number {
  if (!vatMode || vatMode === "exempt" || vatMode === "0") return 0;
  const rate = Number(vatMode);
  return money(Math.max(0, grossAmount) * rate / (100 + rate));
}

export function calculateTaxPeriod(input: TaxPeriodInput): TaxPeriodResult {
  const outputVat = input.outputVatConfirmed == null
    ? includedVat(input.vatTaxableIncomeGross ?? input.marketplaceIncomeGross, input.vatMode)
    : money(Math.max(0, input.outputVatConfirmed));
  const deductionAllowed = vatAllowsInputDeduction(input.vatMode);
  const bankConfirmedInputVat = deductionAllowed
    ? input.bankExpenses.reduce((sum, expense) => (
      expense.vatDocumentStatus === "received" && expense.vatDeductionStatus === "eligible"
        ? sum + Math.min(Math.abs(expense.grossAmount), Math.max(0, expense.vatAmount))
        : sum
    ), 0)
    : 0;
  const confirmedInputVat = money(bankConfirmedInputVat + (deductionAllowed ? Math.max(0, input.marketplaceInputVatConfirmed ?? 0) : 0));
  const usnIncome = money(Math.max(0, input.marketplaceIncomeGross - outputVat));
  const includedBankExpenses = input.bankExpenses.reduce((sum, expense) => {
    if (expense.usnExpenseStatus !== "included") return sum;
    const deductibleVat = deductionAllowed
      && expense.vatDocumentStatus === "received"
      && expense.vatDeductionStatus === "eligible"
      ? Math.min(Math.abs(expense.grossAmount), Math.max(0, expense.vatAmount))
      : 0;
    return sum + Math.max(0, Math.abs(expense.grossAmount) - deductibleVat);
  }, 0);
  const marketplaceVatRemoved = deductionAllowed ? Math.max(0, input.marketplaceInputVatInUsnExpenses ?? input.marketplaceInputVatConfirmed ?? 0) : 0;
  const incomeExpenseSystem = input.taxSystem === "usn_income_expense" || input.taxSystem === "ausn_income_expense";
  const incomeSystem = input.taxSystem === "usn_income" || input.taxSystem === "ausn_income";
  const insuranceContributions = Math.max(0, input.insuranceContributions ?? 0);
  const usnExpenses = money(
    Math.max(0, input.marketplaceExpensesGross - marketplaceVatRemoved)
    + includedBankExpenses
    + (incomeExpenseSystem ? insuranceContributions : 0),
  );
  const priorYearLoss = incomeExpenseSystem ? Math.max(0, input.priorYearLoss ?? 0) : 0;
  const usnBase = money(Math.max(0, usnIncome - usnExpenses - priorYearLoss));
  const rate = Math.max(0, input.taxRate ?? 0);
  const usnBeforeReduction = money((incomeExpenseSystem ? usnBase : incomeSystem ? usnIncome : 0) * rate / 100);
  const reductionLimit = Math.min(100, Math.max(0, input.insuranceReductionLimitPercent ?? 0));
  const insuranceContributionsApplied = incomeSystem
    ? money(Math.min(insuranceContributions, usnBeforeReduction * reductionLimit / 100))
    : 0;
  const usnCalculated = money(Math.max(0, usnBeforeReduction - insuranceContributionsApplied));
  const vatBalance = money(outputVat - confirmedInputVat);
  return {
    outputVat,
    confirmedInputVat,
    vatPayable: money(Math.max(0, vatBalance)),
    vatCarryforward: money(Math.max(0, -vatBalance)),
    usnIncome,
    usnExpenses,
    usnBase,
    usnBeforeReduction,
    insuranceContributionsApplied,
    usnCalculated,
    minimumTaxControl: incomeExpenseSystem ? money(usnIncome * 0.01) : 0,
  };
}
