export const UNASSIGNED_COMPANY_LABEL = "Не распределено по компаниям";

export function isLegacySharedExpenseCompany(name: string): boolean {
  return name === "Общая группа РИО" || name === "Основная группа" || name === UNASSIGNED_COMPANY_LABEL;
}

export function companyLabel(name: string): string {
  return isLegacySharedExpenseCompany(name) ? UNASSIGNED_COMPANY_LABEL : name;
}

export function companyGroupLabel(name: string): string {
  return name === "Общая группа РИО" || name === "РИО / ИП Панкратов / ИП Кучеренко"
    ? "Основная группа"
    : name;
}
