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
//     потрачено больше цели — снижают в 76%; заказ дорогой — снижают в 79%;
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

import { WB_RK_BLOCK_UNKNOWN } from "./advertBlocks";

/** Во сколько раз заказ дороже цели считается дорогим, и во сколько — дешёвым. */
export const CPO_CEILING_RATIO = 1.6;
export const CPO_FLOOR_RATIO = 0.6;
/** Шаг настоящего решения. Мельче — это следование за рынком, а не решение. */
export const BID_STEP_PCT = 20;

export interface RkAutoTaskInput {
  /** Вид размещения ЭТОГО дня, а не нынешние настройки кампании. */
  block: string;
  spent: number;
  orders: number;
  views: number;
  bid: number | null;
  /** Остаток товара. null — не знаем, и это не то же самое, что ноль. */
  stock: number | null;
  /**
   * Сколько мы готовы заплатить за заказ. Считается из юнит-экономики
   * (маржа до рекламы × доля на рекламу), а не зашито числом: у разных
   * юрлиц разная маржа, и один порог для всех врёт.
   */
  targetCpo: number | null;
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
  if (input.targetCpo == null || input.targetCpo <= 0) return null;

  const ceiling = input.targetCpo * CPO_CEILING_RATIO;
  const floor = input.targetCpo * CPO_FLOOR_RATIO;
  const cpo = input.orders > 0 ? input.spent / input.orders : null;
  const step = input.bid * (BID_STEP_PCT / 100);
  const down = round2(Math.max(0.01, input.bid - step));
  const up = round2(input.bid + step);

  // ── Ворото 2: полки. Правило ОБРАТНОЕ поисковому ──────────────────────────
  // Там ставка покупает позицию, а не заказ: при отсутствии заказов её
  // поднимают (62% решений), при дорогом заказе тоже поднимают (70%).
  // Ограничителем служит дневной бюджет, а не цена заказа.
  if (isShelfOnly(input.block)) {
    if (input.orders === 0 && input.spent > 0) {
      return {
        note: `Поднять ставку до ${money(up)} ₽`,
        reason: `Полки, заказов нет: ставка покупает позицию — за неё и доплачиваем (потрачено ${money(input.spent)} ₽)`,
        bidTo: up,
      };
    }
    if (cpo != null && cpo > ceiling) {
      return {
        note: `Поднять ставку до ${money(up)} ₽`,
        reason: `Полки, CPO ${money(cpo)} ₽ выше потолка ${money(ceiling)} ₽ — на полках это лечится позицией, а не тушением`,
        bidTo: up,
      };
    }
    return null;
  }

  // ── Ворото 3: поиск. Решают две величины — был ли заказ и сколько он стоил ─
  // Корзины намеренно не участвуют: их влияние в пределах шума (27% против 24%).
  if (!isSearchLike(input.block) && input.block !== "cpc_both" && input.block !== "cpm_both") return null;

  if (input.orders === 0) {
    // Потратили на заказ и не получили его. Порог — сама цель, а не круглое число.
    if (input.spent >= input.targetCpo) {
      return {
        note: `Снизить ставку до ${money(down)} ₽`,
        reason: `Заказов нет, потрачено ${money(input.spent)} ₽ при цели ${money(input.targetCpo)} ₽ за заказ`,
        bidTo: down,
      };
    }
    return null;
  }

  if (cpo != null && cpo > ceiling) {
    return {
      note: `Снизить ставку до ${money(down)} ₽`,
      reason: `Заказ есть, но стоил ${money(cpo)} ₽ при потолке ${money(ceiling)} ₽`,
      bidTo: down,
    };
  }
  if (cpo != null && cpo < floor) {
    return {
      note: `Поднять ставку до ${money(up)} ₽`,
      reason: `Заказ стоил ${money(cpo)} ₽ при поле ${money(floor)} ₽ — есть запас, чтобы купить больше`,
      bidTo: up,
    };
  }
  // Между полом и потолком — рабочий режим. Молчим.
  return null;
}

/**
 * Целевой CPO из юнит-экономики: сколько готовы отдать за заказ.
 *
 * `marginPerUnit` — маржа ДО рекламы на единицу, `adShare` — доля этой маржи,
 * которую владелец согласен отдать в рекламу. Зашивать сюда число нельзя: в
 * разобранной таблице пороги фактически стояли около 300 ₽ снизу и 800 ₽
 * сверху, но это следствие конкретной маржи конкретного товара, а не закон.
 */
export function rkTargetCpo(marginPerUnit: number | null, adShare: number): number | null {
  if (marginPerUnit == null || !Number.isFinite(marginPerUnit) || marginPerUnit <= 0) return null;
  if (!Number.isFinite(adShare) || adShare <= 0 || adShare > 1) return null;
  return round2(marginPerUnit * adShare);
}
