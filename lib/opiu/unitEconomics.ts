// §6 (безопасная часть). Раздельный показ экономики артикула:
// выручка / ожидаемые удержания маркетплейса / ожидаемая выплата /
// себестоимость / ожидаемая прибыль.
//
// ВАЖНО (§6): себестоимость влияет на прибыль, но НЕ вычитается из выплаты
// маркетплейса. Удержания и выплата берутся из уже рассчитанного прогноза
// (мы НЕ вводим новую формулу выплаты, пока она не сверена). Здесь только
// честная арифметическая декомпозиция известных чисел + себестоимость из
// раздела «Затраты». Отсутствующие компоненты остаются null («нет данных»),
// их нельзя показывать нулём (§19).

export interface ArticleBreakdownInput {
  /** Выручка, на которой построена выплата (adaptiveRevenue из прогноза). */
  revenue: number;
  /** Ожидаемая выплата из прогноза (null — доля выплаты неизвестна). */
  forecastPayout: number | null;
  /** Плановые выкупы за месяц (для себестоимости = выкупы × цена себестоимости). */
  planBuyouts: number;
  /** Себестоимость за единицу из product_costs (null — нет данных). */
  costPerUnit: number | null;
}

export interface ArticleBreakdown {
  revenue: number;
  /** Ожидаемые удержания МП = выручка − выплата (null, если выплата неизвестна). */
  withholdings: number | null;
  payout: number | null;
  /** Себестоимость = выкупы × costPerUnit (null, если нет данных). */
  cost: number | null;
  /** Прибыль = выплата − себестоимость (null, если неизвестна выплата или себестоимость). */
  profit: number | null;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function deriveArticleBreakdown(input: ArticleBreakdownInput): ArticleBreakdown {
  const revenue = Number.isFinite(input.revenue) ? input.revenue : 0;
  const payout = input.forecastPayout !== null && Number.isFinite(input.forecastPayout)
    ? input.forecastPayout
    : null;
  const withholdings = payout === null ? null : round2(revenue - payout);
  const cost = input.costPerUnit !== null
    && Number.isFinite(input.costPerUnit)
    && Number.isFinite(input.planBuyouts)
    ? round2(Math.max(0, input.planBuyouts) * input.costPerUnit)
    : null;
  const profit = payout === null || cost === null ? null : round2(payout - cost);
  return { revenue: round2(revenue), withholdings, payout: payout === null ? null : round2(payout), cost, profit };
}

export interface BreakdownTotals {
  revenue: number;
  withholdings: number;
  payout: number;
  cost: number;
  profit: number;
  /** Полнота: у всех ли учтённых артикулов известна себестоимость. */
  costComplete: boolean;
  /** Полнота: у всех ли учтённых артикулов известна выплата. */
  payoutComplete: boolean;
}

/**
 * Суммирует разбивку по артикулам. Неизвестные компоненты в сумму не попадают,
 * но помечают итог как неполный (нельзя выдавать частичный за полный, §19).
 */
export function sumBreakdowns(breakdowns: ArticleBreakdown[]): BreakdownTotals {
  const totals: BreakdownTotals = {
    revenue: 0, withholdings: 0, payout: 0, cost: 0, profit: 0,
    costComplete: true, payoutComplete: true,
  };
  for (const breakdown of breakdowns) {
    totals.revenue = round2(totals.revenue + breakdown.revenue);
    if (breakdown.payout === null) totals.payoutComplete = false;
    else {
      totals.payout = round2(totals.payout + breakdown.payout);
      if (breakdown.withholdings !== null) totals.withholdings = round2(totals.withholdings + breakdown.withholdings);
    }
    if (breakdown.cost === null) totals.costComplete = false;
    else totals.cost = round2(totals.cost + breakdown.cost);
    if (breakdown.profit !== null) totals.profit = round2(totals.profit + breakdown.profit);
  }
  return totals;
}
