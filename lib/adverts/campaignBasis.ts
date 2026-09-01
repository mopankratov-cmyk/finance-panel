/**
 * База для экономики рекламной кампании, в которой больше одного товара.
 *
 * Кампания WB может вести на десяток артикулов, а расход у неё один. Раньше
 * экономика такой кампании считалась по ПЕРВОМУ артикулу из списка: его цена,
 * его себестоимость, его ставки. Первый в массиве — это не «главный», это
 * просто первый, и рекомендация по ставке получалась про товар, на который
 * могла приходиться десятая часть оборота.
 *
 * Здесь собирается взвешенная база: цена и себестоимость — по заказам (столько
 * штук и продано), ставки удержаний — по выручке (WB считает их процентом от
 * неё). Себестоимость честно молчит, если её нет хотя бы у одного товара с
 * заказами: неполная сумма затрат завысила бы маржу.
 *
 * То же правило теперь распространяется на удержания. Раньше неизвестная ставка
 * молча превращалась в ноль и попадала в среднее наравне с настоящими: кампания
 * в кабинете с пустым кэшем комиссий получала «комиссия 0%», точка
 * безубыточности взлетала, и панель показывала зелёное «Увеличить» там, где
 * данных не было вовсе. Ноль — законная ставка эквайринга, но не комиссии WB,
 * поэтому «нет данных» и «ноль процентов» должны различаться.
 */

export interface CampaignSkuFacts {
  nm: number;
  orders: number;
  revenue: number;
  cost: number | null;
  stock: number | null;
  commissionPct: number | null;
  acquiringPct: number | null;
  extraPct: number | null;
}

export interface CampaignBasis {
  /** Средняя цена продавца по заказам кампании. */
  price: number;
  /** Себестоимость на единицу; null — известна не у всех товаров кампании. */
  cost: number | null;
  stock: number | null;
  dailyUnits: number | null;
  commissionPct: number | null;
  acquiringPct: number | null;
  extraPct: number | null;
  skuCount: number;
  /** У скольких товаров кампании известна себестоимость. */
  costKnownCount: number;
  /**
   * Доля выручки кампании, у которой ставка комиссии известна: 1 — известна вся,
   * 0 — не известна нигде, null — считать не из чего (в окне не было выручки).
   *
   * Отдельно от `commissionPct` потому, что среднее по известной части — это
   * ответ на другой вопрос. Среднее говорит «сколько», покрытие — «насколько
   * этому можно верить», и решение о рекомендации принимается по второму.
   */
  feesCoverage: number | null;
}

const finite = (value: number | null | undefined) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

export function campaignEconomicsBasis(rows: CampaignSkuFacts[]): CampaignBasis {
  let orders = 0;
  let revenue = 0;
  let costWeighted = 0;
  let costOrders = 0;
  let costKnownCount = 0;
  let stock = 0;
  let stockKnown = false;
  let commissionWeighted = 0;
  let acquiringWeighted = 0;
  let extraWeighted = 0;
  let rateWeight = 0;
  let feesKnownWeight = 0;
  let missingCost = false;

  for (const row of rows) {
    const rowOrders = Math.max(0, finite(row.orders));
    const rowRevenue = Math.max(0, finite(row.revenue));
    orders += rowOrders;
    revenue += rowRevenue;
    if (row.cost != null && row.cost > 0) {
      costKnownCount++;
      costWeighted += row.cost * rowOrders;
      costOrders += rowOrders;
    } else if (rowOrders > 0) {
      // Товар кампании продаётся, а сколько он стоит — неизвестно. Значит и
      // маржа кампании неизвестна: подставлять сюда ноль нельзя.
      missingCost = true;
    }
    if (row.stock != null) { stock += row.stock; stockKnown = true; }
    // Ставки — процент от выручки. Товар без выручки веса не имеет, иначе
    // спящий SKU перетянул бы среднее на себя.
    if (rowRevenue > 0) {
      rateWeight += rowRevenue;
      // В среднее идут только известные ставки. Строка с неизвестной комиссией
      // не тянет среднее к нулю — она уменьшает покрытие, и это видно снаружи.
      if (row.commissionPct != null) {
        commissionWeighted += row.commissionPct * rowRevenue;
        acquiringWeighted += finite(row.acquiringPct) * rowRevenue;
        extraWeighted += finite(row.extraPct) * rowRevenue;
        feesKnownWeight += rowRevenue;
      }
    }
  }

  return {
    price: orders > 0 ? revenue / orders : 0,
    cost: missingCost || costOrders <= 0 ? null : costWeighted / costOrders,
    stock: stockKnown ? stock : null,
    dailyUnits: rows.length ? orders / 30 : null,
    commissionPct: feesKnownWeight > 0 ? commissionWeighted / feesKnownWeight : null,
    acquiringPct: feesKnownWeight > 0 ? acquiringWeighted / feesKnownWeight : null,
    extraPct: feesKnownWeight > 0 ? extraWeighted / feesKnownWeight : null,
    skuCount: rows.length,
    costKnownCount,
    feesCoverage: rateWeight > 0 ? feesKnownWeight / rateWeight : null,
  };
}
