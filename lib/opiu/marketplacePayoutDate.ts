const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Финансовый отчёт маркетплейса оплачивается по средам через три недели.
 * Если ровно +21 день уже среда, используем её; иначе берём следующую среду.
 */
export function marketplacePayoutDate(periodEnd: string): string {
  if (!ISO_DATE.test(periodEnd)) return "";
  const date = new Date(`${periodEnd}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== periodEnd) return "";
  date.setUTCDate(date.getUTCDate() + 21);
  date.setUTCDate(date.getUTCDate() + (3 - date.getUTCDay() + 7) % 7);
  return date.toISOString().slice(0, 10);
}
