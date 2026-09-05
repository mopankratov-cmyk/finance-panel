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

/**
 * Сколько задание уже ждёт — словами: «ждёт 40 мин», «ждёт 2 дн».
 *
 * Отдельно от formatSince: та описывает УЖЕ СЛУЧИВШИЙСЯ промежуток между
 * двумя отметками («через 2 дн»), а здесь речь про открытый счётчик. «Через
 * 2 дн» на невыполненном задании читается как срок, к которому его сделают.
 *
 * `now` передаётся снаружи: время в компоненте делает разметку сервера и
 * клиента разной, и React ругается на несовпадение.
 */
export function formatWaiting(fromIso: string | null | undefined, nowMs: number): string | null {
  if (!fromIso) return null;
  const from = Date.parse(fromIso);
  if (!Number.isFinite(from) || nowMs < from) return null;
  const minutes = Math.round((nowMs - from) / 60_000);
  if (minutes < 60) return `ждёт ${Math.max(1, minutes)} мин`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `ждёт ${hours} ч`;
  return `ждёт ${Math.round(hours / 24)} дн`;
}

/** Задание, которое ждёт дольше суток, помечаем: очередь работ должна кричать
 *  о просроченном, а не прятать его среди свежих. */
export const TASK_STALE_MS = 24 * 60 * 60 * 1000;
