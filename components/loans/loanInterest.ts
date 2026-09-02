/** Фиксированный платёж процентов за полный месяц по годовой ставке. */
export function fixedMonthlyInterest(principalRub: number, annualRate: number) {
  const value = Number(principalRub) * Number(annualRate) / 100 / 12;
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
}
