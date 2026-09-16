export const COMPANY_BASE_COLUMNS = "id,name,group_name,is_active";
export const COMPANY_TAX_COLUMNS = `${COMPANY_BASE_COLUMNS},tax_system,vat_mode`;
export const COMPANY_TAX_RATE_COLUMNS = `${COMPANY_TAX_COLUMNS},tax_rate,tax_additional_rate`;
export const COMPANY_TAX_UNAVAILABLE = "Налоговый режим и НДС не загрузились. Примените исправляющую миграцию 202609150001_company_tax_settings_retry.sql и обновите страницу. Название, группа и статус компании сохраняются как обычно.";
export const COMPANY_TAX_RATE_UNAVAILABLE = "Индивидуальные ставки пока недоступны. Примените миграцию 202609160001_company_tax_rates.sql и обновите страницу. Налоговый режим, НДС и статус компании сохраняются как обычно.";

export function isMissingCompanyTaxColumn(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && /tax_system|vat_mode/i.test(error.message ?? "") &&
    (error.code === "42703" || error.code === "PGRST204") &&
    /does not exist|could not find/i.test(error.message ?? ""));
}

export function isMissingCompanyTaxRateColumn(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && /tax_rate|tax_additional_rate/i.test(error.message ?? "") &&
    (error.code === "42703" || error.code === "PGRST204") &&
    /does not exist|could not find/i.test(error.message ?? ""));
}

export async function readCompaniesCompat<T extends { error: { code?: string; message?: string } | null }>(read: (columns: string) => PromiseLike<T>) {
  const full = await read(COMPANY_TAX_RATE_COLUMNS);
  if (!full.error) return { result: full, taxSettingsAvailable: true, taxRatesAvailable: true };

  if (isMissingCompanyTaxRateColumn(full.error)) {
    const legacy = await read(COMPANY_TAX_COLUMNS);
    if (!isMissingCompanyTaxColumn(legacy.error)) {
      return { result: legacy, taxSettingsAvailable: true, taxRatesAvailable: false };
    }
    return { result: await read(COMPANY_BASE_COLUMNS), taxSettingsAvailable: false, taxRatesAvailable: false };
  }

  if (isMissingCompanyTaxColumn(full.error)) {
    return { result: await read(COMPANY_BASE_COLUMNS), taxSettingsAvailable: false, taxRatesAvailable: false };
  }

  return { result: full, taxSettingsAvailable: true, taxRatesAvailable: true };
}
