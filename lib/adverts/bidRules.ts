// Автоправила ставок: решение о шаге — чистой функцией, без сети и без базы.
//
// Здесь намеренно нет ни одного обращения наружу. Правило двигает деньги без
// человека, и единственный способ этому доверять — уметь проверить решение на
// столе, подставив цифры. Всё, что связано с WB и Supabase, живёт в роуте.
//
// Три принципа, из которых выведено остальное:
//
//   Молчание вместо догадки. Нет расхода или мало заказов — правило ничего не
//   делает и говорит почему. Биддер, который дёргает ставку на двух заказах,
//   реагирует на шум, а не на факт, и делает это за деньги.
//
//   Мёртвая зона вокруг цели. Без неё ставка колеблется вверх-вниз на каждом
//   прогоне, потому что попасть в цель ровно невозможно, и любое отклонение
//   читается как повод действовать.
//
//   Потолок всегда сильнее шага. Правило не может выйти за границы, заданные
//   человеком, даже если арифметика шага просит больше.

export type BidRuleGoal = "drr" | "cpo";

export interface BidRule {
  id: string;
  advertId: number;
  /** null — правило применяется ко всем артикулам кампании. */
  nmId: number | null;
  goal: BidRuleGoal;
  /** Цель: ДРР в процентах или CPO в валюте кабинета. */
  target: number;
  /** Окно факта в днях. */
  windowDays: number;
  /** Шаг изменения ставки в процентах от текущей. */
  stepPercent: number;
  minBid: number;
  maxBid: number;
  /** Меньше этого числа заказов в окне — правило не срабатывает. */
  minOrders: number;
  enabled: boolean;
}

export interface BidRuleFact {
  /** Расход за окно. */
  spent: number;
  /** Заказов за окно. */
  orders: number;
  /** Сумма заказов за окно — нужна для ДРР. */
  ordersSum: number;
}

export type BidRuleDecision =
  | { action: "hold"; reason: string; currentBid: number; newBid: null }
  | { action: "raise" | "lower"; reason: string; currentBid: number; newBid: number };

/**
 * Ширина мёртвой зоны вокруг цели, в долях от цели.
 *
 * 10% — не подобранное на данных число, а осознанный компромисс: уже шага по
 * умолчанию (правило не должно перепрыгивать собственную мёртвую зону, иначе
 * оно снова колеблется), но заметно больше суточной дрожи ДРР.
 */
const DEAD_ZONE = 0.1;

function round(value: number): number {
  return Math.round(value);
}

/**
 * Факт по цели правила. null — считать не из чего.
 *
 * Ноль здесь был бы враньём в самую опасную сторону: ДРР = 0 читается как
 * «реклама идеально эффективна» и толкает правило поднимать ставку там, где на
 * самом деле просто не было продаж.
 */
export function ruleFactValue(goal: BidRuleGoal, fact: BidRuleFact): number | null {
  if (goal === "drr") {
    if (!fact.ordersSum || !fact.spent) return null;
    return (fact.spent / fact.ordersSum) * 100;
  }
  if (!fact.orders || !fact.spent) return null;
  return fact.spent / fact.orders;
}

/**
 * Что правило сделает со ставкой.
 *
 * Направление одинаково для обеих целей: и ДРР, и CPO — «чем меньше, тем лучше».
 * Факт выше цели значит «реклама дороже, чем договорились» → ставку вниз.
 * Факт заметно ниже цели значит «есть запас» → ставку вверх, чтобы забрать объём.
 */
export function decideBid(rule: BidRule, fact: BidRuleFact, currentBid: number): BidRuleDecision {
  const hold = (reason: string): BidRuleDecision => ({ action: "hold", reason, currentBid, newBid: null });

  if (!rule.enabled) return hold("Правило выключено.");
  if (!Number.isFinite(currentBid) || currentBid <= 0) return hold("Не знаем текущую ставку — менять нечего.");
  if (rule.minBid > rule.maxBid) return hold("Границы ставки заданы наоборот: минимум больше максимума.");

  if (fact.spent <= 0) return hold(`За ${rule.windowDays} дн. расхода не было — правило не вмешивается.`);
  if (fact.orders < rule.minOrders) {
    return hold(`Мало данных: ${fact.orders} заказов за ${rule.windowDays} дн. при пороге ${rule.minOrders}.`);
  }

  const value = ruleFactValue(rule.goal, fact);
  if (value == null) return hold("Факт по цели не считается: нет продаж в окне.");

  const unit = rule.goal === "drr" ? "%" : "";
  const shown = rule.goal === "drr" ? value.toFixed(1) : round(value).toString();
  const upper = rule.target * (1 + DEAD_ZONE);
  const lower = rule.target * (1 - DEAD_ZONE);

  if (value <= upper && value >= lower) {
    return hold(`${rule.goal === "drr" ? "ДРР" : "CPO"} ${shown}${unit} у цели ${rule.target}${unit} — ставка не меняется.`);
  }

  const direction = value > upper ? "lower" : "raise";
  const factor = direction === "lower" ? 1 - rule.stepPercent / 100 : 1 + rule.stepPercent / 100;
  const wanted = round(currentBid * factor);
  const clamped = Math.min(rule.maxBid, Math.max(rule.minBid, wanted));

  if (clamped === currentBid) {
    const edge = direction === "lower" ? `минимуме ${rule.minBid}` : `максимуме ${rule.maxBid}`;
    return hold(`Ставка уже на ${edge} — дальше правило не идёт.`);
  }

  const verb = direction === "lower" ? "выше" : "ниже";
  const clampNote = clamped !== wanted ? ` (шаг просил ${wanted}, упёрлись в границу)` : "";
  return {
    action: direction,
    currentBid,
    newBid: clamped,
    reason: `${rule.goal === "drr" ? "ДРР" : "CPO"} ${shown}${unit} ${verb} цели ${rule.target}${unit} → ${currentBid} → ${clamped}${clampNote}.`,
  };
}

/**
 * Правила по возрастанию риска: сперва те, что снижают ставку.
 *
 * Прогон упирается в лимит запросов WB, и если он оборвётся на середине, то
 * оборваться он должен на повышениях. Недоснизили — потеряли объём; недоподняли
 * при выбранном лимите — просто не потратили лишнего.
 */
export function orderRulesBySafety<T extends { decision: BidRuleDecision }>(items: T[]): T[] {
  const weight = (action: BidRuleDecision["action"]) => (action === "lower" ? 0 : action === "hold" ? 1 : 2);
  return [...items].sort((a, b) => weight(a.decision.action) - weight(b.decision.action));
}
