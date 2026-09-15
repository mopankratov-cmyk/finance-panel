export const COMPANY_BASE_COLUMNS = "id,name,group_name,is_active";
export const COMPANY_TAX_COLUMNS = `${COMPANY_BASE_COLUMNS},tax_system,vat_mode`;
export const COMPANY_TAX_UNAVAILABLE = "Налоговый режим и НДС не загрузились. Примените исправляющую миграцию 202609150001_company_tax_settings_retry.sql и обновите страницу. Название, группа и статус компании сохраняются как обычно.";

export function isMissingCompanyTaxColumn(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && /tax_system|vat_mode/i.test(error.message ?? "") &&
    (error.code === "42703" || error.code === "PGRST204") &&
    /does not exist|could not find/i.test(error.message ?? ""));
}

export async function readCompaniesCompat<T extends { error: { code?: string; message?: string } | null }>(read: (columns: string) => PromiseLike<T>) {
  const result = await read(COMPANY_TAX_COLUMNS);
  if (!isMissingCompanyTaxColumn(result.error)) return { result, taxSettingsAvailable: true };
  return { result: await read(COMPANY_BASE_COLUMNS), taxSettingsAvailable: false };
}
