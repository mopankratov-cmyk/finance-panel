/**
 * План CTR-теста нового движка: раунды и порядок вариантов в них.
 *
 * Термины (владелец, 21.09.2026): РАУНД — полный проход по всем вариантам,
 * ШАГ — показ одного варианта внутри раунда. В базе шаг лежит строкой
 * `ctr_test_rounds` (имя осталось от прежней модели, где «раунд» был одним
 * показом одного варианта).
 *
 * Порядок вариантов в раунде меняется: при фиксированном A-B-C вариант A всегда
 * идёт первым, а общий CTR со временем дрейфует (на тесте 13 он падал по циклам
 * 2,76% → 1,65% → 1,53%), то есть порядок сам смещает сравнение. Перестановка
 * по раундам выравнивает положение варианта во времени.
 */

export const DEFAULT_WARMUP_MIN = 5;
export const DEFAULT_MAX_STEP_MIN = 180;
export const DEFAULT_SETTLE_MAX_MIN = 90;
export const DEFAULT_STABLE_READS = 3;
/** Сколько раз подряд один и тот же сбой терпим, прежде чем поставить тест на паузу (5 минут на проход крона). */
export const MAX_FAIL_STREAK = 4;
export const MAX_ROUNDS = 20;

/**
 * Число раундов из норм мастера: «показов на вариант» / «показов за шаг».
 * Раньше эти два поля давали норму раунда и цель варианта, и теперь по ним же
 * восстанавливается число раундов, чтобы мастер не менялся вместе с движком.
 */
export function deriveRounds(targetImpressions: number, impressionsPerStep: number): number {
  if (!(impressionsPerStep > 0) || !(targetImpressions > 0)) return 1;
  return Math.min(MAX_ROUNDS, Math.max(1, Math.ceil(targetImpressions / impressionsPerStep)));
}

/**
 * Порядок по умолчанию — циклический сдвиг: A-B-C, B-C-A, C-A-B. Каждый вариант
 * побывает в каждой позиции раунда, пока раундов не меньше числа вариантов.
 */
export function buildVariantOrders(count: number, rounds: number): number[][] {
  const base = Array.from({ length: count }, (_, index) => index);
  return Array.from({ length: rounds }, (_, round) => {
    const shift = round % Math.max(1, count);
    return [...base.slice(shift), ...base.slice(0, shift)];
  });
}

type OrdersResult = { ok: true; orders: number[][] } | { ok: false; error: string };

/**
 * Порядок, присланный человеком: по одному списку позиций (с нуля) на раунд.
 * Каждый список — перестановка всех вариантов: без этого раунд «A-B-B» тихо
 * недодал бы показов C, а «A-B» — выкинул бы его из раунда.
 */
export function normalizeVariantOrders(input: unknown, count: number, rounds: number): OrdersResult {
  if (input == null || (Array.isArray(input) && input.length === 0)) return { ok: true, orders: buildVariantOrders(count, rounds) };
  if (!Array.isArray(input) || input.length !== rounds) {
    return { ok: false, error: `Порядок вариантов нужно задать для каждого из ${rounds} раундов` };
  }
  const orders: number[][] = [];
  for (const [round, entry] of input.entries()) {
    if (!Array.isArray(entry) || entry.length !== count) {
      return { ok: false, error: `Раунд ${round + 1}: в порядке должны быть все ${count} вариантов ровно по разу` };
    }
    const positions = entry.map(Number);
    const isPermutation = positions.every((value) => Number.isInteger(value) && value >= 0 && value < count) && new Set(positions).size === count;
    if (!isPermutation) return { ok: false, error: `Раунд ${round + 1}: в порядке должны быть все ${count} вариантов ровно по разу` };
    orders.push(positions);
  }
  return { ok: true, orders };
}

export interface PlannedStep {
  /** Номер раунда (прохода), с единицы. */
  passNo: number;
  /** Место шага внутри раунда, с нуля. */
  indexInPass: number;
  variantId: number;
}

/**
 * Какой шаг идёт следующим, если закрыто `closedSteps` шагов. null — план
 * выполнен. Позиция считается по ЗАКРЫТЫМ шагам, а не по номеру строки: шаг,
 * который пришлось повторить, занимает лишнюю строку, но место в плане то же.
 */
export function planStep(orders: number[][], closedSteps: number): PlannedStep | null {
  const perPass = orders[0]?.length ?? 0;
  if (perPass === 0 || closedSteps < 0 || closedSteps >= orders.length * perPass) return null;
  const passIndex = Math.floor(closedSteps / perPass);
  const indexInPass = closedSteps % perPass;
  return { passNo: passIndex + 1, indexInPass, variantId: orders[passIndex][indexInPass] };
}

export function totalSteps(orders: number[][]): number {
  return orders.length * (orders[0]?.length ?? 0);
}

/**
 * Правка порядка в мастере: сдвиг одного варианта на место вверх или вниз.
 * Возвращает НОВЫЙ массив: состояние React не мутируется.
 */
export function moveInOrder(order: number[], index: number, delta: -1 | 1): number[] {
  const target = index + delta;
  if (index < 0 || index >= order.length || target < 0 || target >= order.length) return order;
  const next = [...order];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * Годится ли порядок, заданный руками, к нынешним числу вариантов и раундов.
 * Человек мог поменять их уже после того, как расставил порядок: старая
 * расстановка тогда либо не покрывает новых раундов, либо теряет вариант.
 */
export function ordersFit(orders: number[][] | null | undefined, count: number, rounds: number): orders is number[][] {
  return Array.isArray(orders)
    && orders.length === rounds
    && orders.every((order) => order.length === count && new Set(order).size === count && order.every((position) => Number.isInteger(position) && position >= 0 && position < count));
}
