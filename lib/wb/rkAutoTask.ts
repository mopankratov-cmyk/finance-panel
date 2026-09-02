// Автозаполнение задач в журнале РК.
//
// Правила выведены не из общих соображений, а из рабочей таблицы владельца
// «Показы CTR CPC»: 380 строк «товар × размещение», 131 день, 8 046 дней со
// ставкой. Что показал разбор:
//
//   • решения — редкость: в 61% дней ставку не трогают вовсе, а из изменений
//     66% на CPC и 80% на CPM мельче 5% — это следование за минимальной
//     ставкой, а не решение. Настоящих решений (шаг крупнее 15%) — 303;
//   • правило на поиске и на полках ПРОТИВОПОЛОЖНОЕ. CPC: заказов нет и
//     потрачено много — снижают в 76%; заказ дорогой — снижают в 79%;
//     заказ дешёвый — поднимают в 57%. Полки: заказов нет — ПОДНИМАЮТ в 62%,
//     дорогой заказ — поднимают в 70%. На полках ставка покупает позицию, а не
//     заказ, и ограничителем работает дневной бюджет;
//   • корзины на решение почти не влияют: 27% против базовых 24% — шум;
//   • задача ставится только там, где заполнен остаток: 52 строки из 62 с
//     задачей имеют остаток, из 318 без задачи — ни одна.
//
// Отсюда главное свойство этого модуля: он МОЛЧИТ чаще, чем говорит. Советчик,
// который пишет что-то каждый день по каждой строке, превращается в шум и его
// выключают.
//
// Мера «дорого» — ДРР, процент рекламы от заказов, а не рубли и не доля маржи.
// Порог в рублях у товара за 500 ₽ и за 5 000 ₽ означает разное; доля маржи
// требует числа, которого никто не знает наверняка. ДРР же виден в самих
// данных, и границы берутся из истории КАБИНЕТА (computeRkTaskBounds).

import { WB_RK_BLOCK_UNKNOWN } from "./advertBlocks";

/** Шаг настоящего решения. Мельче — это следование за рынком, а не решение. */
export const BID_STEP_PCT = 20;

/**
 * Границы, по которым день считается дорогим или дешёвым.
 *
 * Не зашиты числом и не выведены из доли маржи: берутся из ИСТОРИИ САМОГО
 * КАБИНЕТА (computeRkTaskBounds). Мера — ДРР, процент рекламы от заказов: он
 * сам подстраивается под цену товара, тогда как порог в рублях у товара за
 * 500 ₽ и за 5 000 ₽ означает разное.
 *
 * Для дня БЕЗ заказов ДРР не определён — там мерой служит сам расход, и его
 * граница тоже берётся из истории кабинета.
 */
export interface RkTaskBounds {
  /** Расход за день без единого заказа, выше которого пора снижать. */
  spendWithoutOrder: number;
  /** ДРР выше этого — реклама съедает слишком много. */
  drrCeilingPct: number;
  /** ДРР ниже этого при живых заказах — есть запас, чтобы купить больше. */
  drrFloorPct: number;
}

/**
 * Границы СЛОЁНО по августу 2026 — значение по умолчанию, пока история
 * кабинета не посчитана. Замер на 5 446 артикуло-днях: ДРР 90-го перцентиля
 * 11,5%, 75-го — 5,7%; расход без заказов 90-го перцентиля 1 109 ₽.
 * Отдельная сверка: 90-й перцентиль CPO дал 869 ₽ — почти ровно тот порог
 * «дорогого заказа» в 800 ₽, который читается из рабочей таблицы владельца.
 * Две независимые выборки на одной границе — повод ей верить.
 */
export const RK_DEFAULT_BOUNDS: RkTaskBounds = {
  spendWithoutOrder: 1_000,
  drrCeilingPct: 12,
  drrFloorPct: 2,
};

interface RkTaskHistoryRow {
  /** Полный расход за артикуло-день. */
  spend: number;
  orders: number;
  /** Сумма заказов за тот же день — знаменатель ДРР. */
  ordersSum: number;
}

const percentile = (sorted: number[], p: number): number | null =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null;

/**
 * Границы из истории кабинета. Советчик должен срабатывать на верхних
 * десяти процентах, а не на каждой строке: 90-й перцентиль и есть «дорого»
 * по меркам этого кабинета, а не по чужим.
 *
 * `null` в ответе — истории мало, и выдумывать границы нельзя.
 */
export function computeRkTaskBounds(history: readonly RkTaskHistoryRow[]): RkTaskBounds | null {
  const spent = history.filter((row) => row.spend >= 1);
  if (spent.length < 100) return null;
  const drr = spent
    .filter((row) => row.orders > 0 && row.ordersSum > 0)
    .map((row) => (row.spend / row.ordersSum) * 100)
    .sort((left, right) => left - right);
  const noOrders = spent.filter((row) => row.orders === 0).map((row) => row.spend).sort((left, right) => left - right);
  const ceiling = percentile(drr, 0.9);
  const floor = percentile(drr, 0.25);
  // Дней без заказов может не быть вовсе — у кабинета, где реклама всегда что-то
  // приносит. Это не повод остаться без границ по ДРР: недостающую составляющую
  // берём из умолчания, а не отменяем весь расчёт.
  const spendCut = percentile(noOrders, 0.9) ?? RK_DEFAULT_BOUNDS.spendWithoutOrder;
  if (ceiling == null || floor == null) return null;
  return {
    spendWithoutOrder: round2(spendCut),
    drrCeilingPct: round2(ceiling),
    // Пол не может совпасть с потолком: у кабинета, где почти всё бесплатно,
    // 25-й перцентиль вырождается в ноль и «поднять» не сработает никогда.
    drrFloorPct: round2(Math.max(0.5, Math.min(floor, ceiling / 4))),
  };
}

export interface RkAutoTaskInput {
  /** Вид размещения ЭТОГО дня, а не нынешние настройки кампании. */
  block: string;
  spent: number;
  orders: number;
  views: number;
  bid: number | null;
  /** Остаток товара. null — не знаем, и это не то же самое, что ноль. */
  stock: number | null;
  /** Сумма заказов за день — знаменатель ДРР. */
  ordersSum: number;
  /** Границы кабинета. Берутся из его же истории, а не зашиты числом. */
  bounds: RkTaskBounds;
  /** День закрыт целиком. Незакрытый день советовать нельзя. */
  dayClosed: boolean;
}

export interface RkAutoTaskSuggestion {
  /** Текст задачи — то, что увидит человек в клетке. */
  note: string;
  /** Почему так. Показывается рядом и попадает в разбор расхождений. */
  reason: string;
  /** Куда двигаем ставку. null — задача не про ставку. */
  bidTo: number | null;
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const money = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 2 });

const isShelfOnly = (block: string) => block === "cpc_shelf" || block === "cpm_shelf";
const isSearchLike = (block: string) => block === "cpc_search" || block === "cpm_search";

/**
 * Задача на день по одной строке журнала. `null` — советовать нечего, и это
 * штатный, самый частый ответ.
 */
export function suggestRkTask(input: RkAutoTaskInput): RkAutoTaskSuggestion | null {
  // ── Ворото 1: есть ли что советовать ───────────────────────────────────────
  // Живой день, невыясненный вид размещения и полная тишина — поводы молчать,
  // а не угадывать. Тишина в показах это «не крутилось», а не «плохо крутилось».
  if (!input.dayClosed) return null;
  if (!input.block || input.block === WB_RK_BLOCK_UNKNOWN) return null;

  // Остаток нулевой — рекламировать нечего, и это единственный случай, где
  // совет не про ставку. Про null молчим: «не знаем остаток» ≠ «остатка нет».
  if (input.stock === 0) {
    return {
      note: "Откл до отгрузки",
      reason: "Остаток нулевой — рекламировать нечего",
      bidTo: null,
    };
  }

  if (input.views <= 0) return null;
  // ЕРК управляется правилами WB, переносить на неё логику ручной ставки нельзя.
  if (input.block === "erk") return null;
  if (input.bid == null || input.bid <= 0) return null;

  const { bounds } = input;
  // ДРР — процент рекламы от заказов. Порог в рублях у товара за 500 ₽ и за
  // 5 000 ₽ означает разное, а этот сам подстраивается под цену.
  const drr = input.orders > 0 && input.ordersSum > 0 ? (input.spent / input.ordersSum) * 100 : null;
  const step = input.bid * (BID_STEP_PCT / 100);
  const down = round2(Math.max(0.01, input.bid - step));
  const up = round2(input.bid + step);

  // ── Ворото 2: полки. Правило ОБРАТНОЕ поисковому ──────────────────────────
  // Там ставка покупает позицию, а не заказ: при отсутствии заказов её
  // поднимают (62% решений), при дорогом заказе тоже поднимают (70%).
  // Ограничителем служит дневной бюджет, а не цена заказа.
  if (isShelfOnly(input.block)) {
    // Порог тот же, что на поиске: «заплатили заметно и не получили ничего».
    // Без него совет срабатывал на копейках — прогон по живому дню выдал
    // «поднять ставку до 247 ₽» при расходе 21 копейка, что не сигнал, а шум.
    if (input.orders === 0 && input.spent >= bounds.spendWithoutOrder) {
      return {
        note: `Поднять ставку до ${money(up)} ₽`,
        reason: `Полки, заказов нет при расходе ${money(input.spent)} ₽: ставка покупает позицию — за неё и доплачиваем`,
        bidTo: up,
      };
    }
    if (drr != null && drr > bounds.drrCeilingPct) {
      return {
        note: `Поднять ставку до ${money(up)} ₽`,
        reason: `Полки, ДРР ${money(drr)}% выше потолка ${money(bounds.drrCeilingPct)}% — на полках это лечится позицией, а не тушением`,
        bidTo: up,
      };
    }
    return null;
  }

  // ── Ворото 3: поиск. Решают две величины — был ли заказ и сколько он стоил ─
  // Корзины намеренно не участвуют: их влияние в пределах шума (27% против 24%).
  if (!isSearchLike(input.block) && input.block !== "cpc_both" && input.block !== "cpm_both") return null;

  if (input.orders === 0) {
    // Заказов нет — ДРР не определён, и мерой служит сам расход. Граница взята
    // из истории кабинета: выше неё он тратит лишь в десятой части дней.
    if (input.spent >= bounds.spendWithoutOrder) {
      return {
        note: `Снизить ставку до ${money(down)} ₽`,
        reason: `Заказов нет, потрачено ${money(input.spent)} ₽ при границе ${money(bounds.spendWithoutOrder)} ₽`,
        bidTo: down,
      };
    }
    return null;
  }

  if (drr != null && drr > bounds.drrCeilingPct) {
    return {
      note: `Снизить ставку до ${money(down)} ₽`,
      reason: `Заказы есть, но реклама съела ${money(drr)}% от них при потолке ${money(bounds.drrCeilingPct)}%`,
      bidTo: down,
    };
  }
  if (drr != null && drr < bounds.drrFloorPct) {
    return {
      note: `Поднять ставку до ${money(up)} ₽`,
      reason: `Реклама съела ${money(drr)}% от заказов при поле ${money(bounds.drrFloorPct)}% — есть запас, чтобы купить больше`,
      bidTo: up,
    };
  }
  // Между полом и потолком — рабочий режим. Молчим.
  return null;
}
