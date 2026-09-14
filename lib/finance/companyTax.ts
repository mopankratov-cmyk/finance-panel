export const COMPANY_TAX_SYSTEMS = [
  { value: "osno", label: "ОСНО" },
  { value: "usn_income", label: "УСН «Доходы»" },
  { value: "usn_income_expense", label: "УСН «Доходы минус расходы»" },
  { value: "ausn_income", label: "АвтоУСН «Доходы»" },
  { value: "ausn_income_expense", label: "АвтоУСН «Доходы минус расходы»" },
  { value: "patent", label: "ПСН (патент)" },
  { value: "npd", label: "НПД" },
  { value: "eshn", label: "ЕСХН" },
] as const;

export const COMPANY_VAT_MODES = [
  { value: "exempt", label: "Без НДС / освобождение" },
  { value: "0", label: "НДС 0%" },
  { value: "5", label: "НДС 5%" },
  { value: "7", label: "НДС 7%" },
  { value: "10", label: "НДС 10%" },
  { value: "22", label: "НДС 22%" },
] as const;

export type CompanyTaxSystem = (typeof COMPANY_TAX_SYSTEMS)[number]["value"];
export type CompanyVatMode = (typeof COMPANY_VAT_MODES)[number]["value"];

const TAX_SYSTEM_VALUES = new Set<string>(COMPANY_TAX_SYSTEMS.map((option) => option.value));
const VAT_MODE_VALUES = new Set<string>(COMPANY_VAT_MODES.map((option) => option.value));

export function parseCompanyTaxSystem(value: unknown): CompanyTaxSystem | null | undefined {
  if (value === null || value === "") return null;
  return typeof value === "string" && TAX_SYSTEM_VALUES.has(value) ? value as CompanyTaxSystem : undefined;
}

export function parseCompanyVatMode(value: unknown): CompanyVatMode | null | undefined {
  if (value === null || value === "") return null;
  return typeof value === "string" && VAT_MODE_VALUES.has(value) ? value as CompanyVatMode : undefined;
}
