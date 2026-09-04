/** Сколько прошло между двумя отметками — словами, как в ленте событий:
 *  «через 25 мин», «через 3 ч», «через 2 дн». Тайминг итерации по ТЗ
 *  не вводится руками, а считается из отметок «поставлено» и «выполнено». */
export function formatSince(fromIso: string | null | undefined, toIso: string | null | undefined): string | null {
  if (!fromIso || !toIso) return null;
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  const minutes = Math.round((to - from) / 60_000);
  if (minutes < 1) return "сразу";
  if (minutes < 60) return `через ${minutes} мин`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `через ${hours} ч`;
  const days = Math.round(hours / 24);
  return `через ${days} дн`;
}
