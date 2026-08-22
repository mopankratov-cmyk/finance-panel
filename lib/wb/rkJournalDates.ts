// Даты журнала РК считаются по Москве, а не по UTC.
//
// Крон Vercel ходит в 03:00 UTC — это 06:00 МСК. В этот момент по UTC ещё
// сегодняшнее число, а «вчера по Москве» отстоит от него на день. Без сдвига
// снимок в 06:00 брал бы позавчерашний день.

const MSK_OFFSET_MS = 3 * 3_600_000;

/** Сегодняшняя дата по Москве в формате ГГГГ-ММ-ДД. */
export function moscowToday(now: Date = new Date()): string {
  return new Date(now.getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10);
}

/** Вчерашняя дата по Москве: день закрыт, его и снимают утром. */
export function moscowYesterday(now: Date = new Date()): string {
  const msk = new Date(now.getTime() + MSK_OFFSET_MS);
  msk.setUTCDate(msk.getUTCDate() - 1);
  return msk.toISOString().slice(0, 10);
}
