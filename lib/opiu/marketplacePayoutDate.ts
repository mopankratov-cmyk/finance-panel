const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Маркетплейсы закрывают выплатную неделю в воскресенье и отправляют деньги
 * в среду через три недели. Месячная граница может разрезать одну неделю на
 * два отчёта (например, 28–30 сентября и 1–4 октября), поэтому сначала
 * доводим дату конца части отчёта до воскресенья её календарной недели.
 */
export function marketplacePayoutDate(reportPeriodDate: string): string {
  if (!ISO_DATE.test(reportPeriodDate)) return "";
  const date = new Date(`${reportPeriodDate}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== reportPeriodDate) return "";
  date.setUTCDate(date.getUTCDate() + (7 - date.getUTCDay()) % 7);
  date.setUTCDate(date.getUTCDate() + 21);
  date.setUTCDate(date.getUTCDate() + (3 - date.getUTCDay() + 7) % 7);
  return date.toISOString().slice(0, 10);
}
