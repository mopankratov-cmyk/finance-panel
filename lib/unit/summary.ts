/**
 * Сводка над таблицей юнит-экономики: прибыль, маржа, выручка по тем строкам,
 * которые человек сейчас видит на экране.
 *
 * Здесь легко получить красивую неправду, поэтому две вещи зафиксированы явно.
 *
 * 1. Прибыль считается ПО ВЫКУПАМ. Все ставки удержаний WB (комиссия, эквайринг,
 *    логистика, хранение, штрафы) выведены из отчёта как доля от суммы ПРОДАЖ —
 *    см. `lib/wb/commissions.ts`, где выручка накапливается только по строкам
 *    «Продажа». Значит маржа с единицы описывает выкупленную единицу, а не
 *    заказанную. Умножение маржи на заказы завышало прибыль ровно во столько
 *    раз, во сколько заказов больше выкупов, — при выкупе 60% это +67%.
 *
 * 2. Реклама вычитается ЦЕЛИКОМ, а не в доле выкупов. Деньги за показы списаны
 *    независимо от того, забрал покупатель товар или отказался.
 *
 * Из-за (1) короткие периоды выглядят убыточными: заказ виден сразу, а выкуп —
 * через дни доставки. Это не ошибка расчёта, а свойство данных, и интерфейс
 * обязан говорить об этом словами, а не прятать разрыв, подменяя выкупы
 * заказами.
 */

export interface UnitSummaryRow {
  /** Выручка ЗАКАЗОВ за период. */
  revenue: number;
  orders: number;
  /** Фактический процент выкупа периода: продажи / заказы. */
  buyoutPct: number | null;
  /** Маржа с единицы после ДРР и налога; null — посчитать нечем. */
  marginUnit: number | null;
  /** Расход рекламы за период по строке. */
  ad: number;
  cost: number | null;
}

export interface UnitSummary {
  sku: number;
  /** Выручка заказов — то, что заказали. */
  ordersRevenue: number;
  /** Выручка выкупов — то, что действительно выкупили. */
  buyoutRevenue: number;
  orders: number;
  buyouts: number;
  /** Прибыль по выкупам за вычетом всей рекламы периода. */
  profit: number;
  /** Маржа = прибыль / выручка выкупов по строкам, где маржа посчитана. */
  marginPct: number | null;
  negative: number;
  costKnown: number;
}

const finite = (value: number | null | undefined): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

export function summarizeUnitRows(rows: UnitSummaryRow[]): UnitSummary {
  let ordersRevenue = 0;
  let buyoutRevenue = 0;
  let orders = 0;
  let buyouts = 0;
  let profit = 0;
  let profitRevenue = 0;
  let negative = 0;
  let costKnown = 0;

  for (const row of rows) {
    const rowOrders = finite(row.orders);
    const rowRevenue = finite(row.revenue);
    const rowAd = finite(row.ad);
    // Неизвестный процент выкупа бывает только при нулевых заказах: тогда и
    // выкупов ноль, и подставлять сюда 100% нечего.
    const share = row.buyoutPct == null ? 0 : Math.max(0, row.buyoutPct) / 100;
    const rowBuyouts = rowOrders * share;
    const price = rowOrders > 0 ? rowRevenue / rowOrders : 0;

    ordersRevenue += rowRevenue;
    orders += rowOrders;
    buyouts += rowBuyouts;
    buyoutRevenue += price * rowBuyouts;
    if (row.cost != null && row.cost > 0) costKnown++;

    if (row.marginUnit != null) {
      // Маржа/ед в таблице уже за вычетом рекламы на заказ. Возвращаем рекламу
      // обратно в единицу и вычитаем её один раз целиком: иначе часть расхода
      // «списалась бы» вместе с невыкупленными заказами.
      const adPerOrder = rowOrders > 0 ? rowAd / rowOrders : 0;
      const marginBeforeAd = row.marginUnit + adPerOrder;
      profit += marginBeforeAd * rowBuyouts - rowAd;
      profitRevenue += price * rowBuyouts;
      if (row.marginUnit < 0) negative++;
    }
  }

  return {
    sku: rows.length,
    ordersRevenue,
    buyoutRevenue,
    orders,
    buyouts,
    profit,
    // Процент считается только по SKU с посчитанной маржой, иначе его размывала
    // бы выручка строк без себестоимости.
    marginPct: profitRevenue > 0 ? (profit / profitRevenue) * 100 : null,
    negative,
    costKnown,
  };
}
