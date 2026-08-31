/**
 * Сверка «синк отчитался» с «данные появились».
 *
 * Проверка здоровья смотрела только на `wb_sync_state`: job отработал недавно и
 * не упал — значит «Данные синхронизированы». Ровно так экран и писал в день,
 * когда продаж не было десять суток подряд: синк исправно ходил к WB, получал
 * пустой ответ и честно отчитывался об успехе. Разрыв между «сходил» и
 * «принёс» никто не смотрел, и разбор занял полдня.
 *
 * Правило простое: если источник молчит несколько дней, а СОСЕДНИЙ источник
 * того же кабинета данные приносит, тишина — не затишье в продажах, а дыра.
 * Когда молчат оба, это остаётся предупреждением: у кабинета может не быть ни
 * заказов, ни продаж, и красить такое в аварию нельзя.
 */

/** Сколько дней тишины терпим, пока синк отчитывается об успехе. */
export const FACT_GAP_DAYS = 2;

export interface SyncFactInput {
  /** Дата свежайшей строки этого источника, ГГГГ-ММ-ДД. */
  own: string | null;
  /** То же у соседнего источника — он и отличает дыру от затишья. */
  peer: string | null;
  /** Как назвать соседа в подписи. */
  peerName: string;
  /** Сегодняшний день, ГГГГ-ММ-ДД. */
  today: string;
}

export interface SyncFactVerdict {
  state: "warning" | "error";
  detail: string;
}

const isoDay = (value: string | null) => (value ? value.slice(0, 10) : null);

export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** `null` — придраться не к чему: данные приходят. */
export function syncFactVerdict(input: SyncFactInput): SyncFactVerdict | null {
  const own = isoDay(input.own);
  if (!own) return { state: "warning", detail: "Синк отчитывается об успехе, но строк в базе нет вовсе" };

  const silence = daysBetween(own, input.today);
  if (silence <= FACT_GAP_DAYS) return null;

  const peer = isoDay(input.peer);
  const peerIsFresh = peer != null && daysBetween(peer, input.today) <= FACT_GAP_DAYS;
  const tail = `последняя строка за ${own.split("-").reverse().join(".")}, тишина ${silence} дн.`;
  return peerIsFresh
    ? { state: "error", detail: `Синк отчитывается об успехе, но данных нет: ${tail}. «${input.peerName}» за это время данные приносит` }
    : { state: "warning", detail: `Синк отчитывается об успехе, но данных нет: ${tail}` };
}
