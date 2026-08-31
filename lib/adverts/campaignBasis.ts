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
      commissionWeighted += finite(row.commissionPct) * rowRevenue;
      acquiringWeighted += finite(row.acquiringPct) * rowRevenue;
      extraWeighted += finite(row.extraPct) * rowRevenue;
      rateWeight += rowRevenue;
    }
  }

  return {
    price: orders > 0 ? revenue / orders : 0,
    cost: missingCost || costOrders <= 0 ? null : costWeighted / costOrders,
    stock: stockKnown ? stock : null,
    dailyUnits: rows.length ? orders / 30 : null,
    commissionPct: rateWeight > 0 ? commissionWeighted / rateWeight : null,
    acquiringPct: rateWeight > 0 ? acquiringWeighted / rateWeight : null,
    extraPct: rateWeight > 0 ? extraWeighted / rateWeight : null,
    skuCount: rows.length,
    costKnownCount,
  };
}
