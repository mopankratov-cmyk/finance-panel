/** Русское склонение после числа: «1 код», «2 кода», «5 кодов».
 *  Живёт отдельно, потому что полоса дел показывает счётчики в кнопках, а
 *  «5 кода просрочены» в интерфейсе учёта читается как неисправность. */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.trunc(n));
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = abs % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
