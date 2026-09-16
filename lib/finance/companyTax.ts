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

const VARIABLE_RATE_SYSTEMS = new Set<CompanyTaxSystem>([
  "osno",
  "usn_income",
  "usn_income_expense",
  "ausn_income",
  "ausn_income_expense",
  "eshn",
]);

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

export function companyTaxSystemSupportsRate(value: CompanyTaxSystem | null): boolean {
  return value !== null && VARIABLE_RATE_SYSTEMS.has(value);
}

export function parseCompanyTaxRate(value: unknown): number | null | undefined {
  if (value === null || value === "") return null;
  const normalized = typeof value === "string" ? value.trim().replace(",", ".") : value;
  if (normalized === "") return null;
  const parsed = typeof normalized === "number" ? normalized : Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return undefined;
  const rounded = Math.round(parsed * 1_000) / 1_000;
  return Math.abs(parsed - rounded) < 1e-9 ? rounded : undefined;
}

export function formatCompanyTaxRate(value: number | null | undefined): string {
  if (value == null) return "";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value);
}

export function companyTaxTotalRate(baseRate: number | null, additionalRate: number | null): number | null {
  if (baseRate === null && additionalRate === null) return null;
  return Math.round(((baseRate ?? 0) + (additionalRate ?? 0)) * 1_000) / 1_000;
}
