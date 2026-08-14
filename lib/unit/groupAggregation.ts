export interface UnitContribution {
  cabinetId: string;
  nmId: number;
  article: string;
  orders: number;
  revenue: number;
  buyouts: number;
  stock: number;
  adSpend: number;
  costPerUnit: number | null;
  marketplacePct: number | null;
  acquiringPct: number | null;
  ratesFactual: boolean;
  /**
   * Доля СПП (0..1) по факту продаж периода. `null` — фактов нет, СПП неизвестна,
   * и налог придётся считать от цены продавца (это завышает его на величину СПП).
   */
  sppShare?: number | null;
}

export interface AggregatedUnitRow {
  nmId: number;
  article: string;
  orders: number;
  revenue: number;
  buyouts: number;
  stock: number;
  adSpend: number;
  costPerUnit: number | null;
  marketplaceRub: number | null;
  marketplacePct: number | null;
  marketplacePerUnit: number | null;
  acquiringRub: number | null;
  taxRub: number;
  /** Выручка по цене покупателя (после СПП) — с неё и считается налог. */
  taxableRevenue: number;
  /** Есть ли факт СПП хотя бы по одному кабинету этого SKU. */
  sppKnown: boolean;
  drrPct: number | null;
  buyoutPct: number | null;
  marginPerUnit: number | null;
  marginBeforeDrrPct: number | null;
  marginAfterDrrPct: number | null;
}

export function aggregateUnitContributions(
  contributions: UnitContribution[],
  options: { taxPct: number; ff: number },
): AggregatedUnitRow[] {
  const groups = new Map<number, UnitContribution[]>();
  for (const contribution of contributions) {
    const rows = groups.get(contribution.nmId) ?? [];
    if (rows.length > 0 && rows[0].article !== contribution.article) {
      throw new Error(`Артикул SKU ${contribution.nmId} различается между кабинетами`);
    }
    rows.push(contribution);
    groups.set(contribution.nmId, rows);
  }

  return [...groups.entries()].map(([nmId, rows]) => {
    const sum = (pick: (row: UnitContribution) => number) => rows.reduce((total, row) => total + pick(row), 0);
    const orders = sum((row) => row.orders);
    const revenue = sum((row) => row.revenue);
    const buyouts = sum((row) => row.buyouts);
    const stock = sum((row) => row.stock);
    const adSpend = sum((row) => row.adSpend);
    const revenueBearing = rows.filter((row) => row.revenue > 0);
    const ratesKnown = revenueBearing.every((row) =>
      row.ratesFactual && row.marketplacePct != null && row.acquiringPct != null);
    const costKnown = rows
      .filter((row) => row.orders > 0)
      .every((row) => row.costPerUnit != null && row.costPerUnit > 0);
    const marketplaceRub = ratesKnown
      ? sum((row) => row.revenue * (row.marketplacePct ?? 0) / 100)
      : null;
    const acquiringRub = ratesKnown
      ? sum((row) => row.revenue * (row.acquiringPct ?? 0) / 100)
      : null;
    const cogs = costKnown ? sum((row) => row.orders * (row.costPerUnit ?? 0)) : null;
    const fulfillment = orders * options.ff;
    // Налог — с цены покупателя, то есть с выручки за вычетом СПП каждого кабинета.
    // Кабинет без факта СПП входит в базу целиком: занизить налог догадкой хуже, чем
    // оставить его прежним и показать это в покрытии.
    const taxableRevenue = sum((row) => row.revenue * (1 - (row.sppShare ?? 0)));
    const sppKnown = rows.some((row) => row.sppShare != null);
    const taxRub = taxableRevenue * options.taxPct / 100;
    const marginBeforeAd = cogs != null && marketplaceRub != null && acquiringRub != null
      ? revenue - cogs - fulfillment - marketplaceRub - acquiringRub - taxRub
      : null;
    const margin = marginBeforeAd == null ? null : marginBeforeAd - adSpend;
    return {
      nmId,
      article: rows[0].article,
      orders,
      revenue,
      buyouts,
      stock,
      adSpend,
      costPerUnit: costKnown && orders > 0 ? (cogs ?? 0) / orders : null,
      marketplaceRub,
      marketplacePct: marketplaceRub != null && revenue > 0 ? marketplaceRub / revenue * 100 : null,
      marketplacePerUnit: marketplaceRub != null && revenue > 0 && orders > 0 ? marketplaceRub / orders : null,
      acquiringRub,
      taxRub,
      taxableRevenue,
      sppKnown,
      drrPct: revenue > 0 ? adSpend / revenue * 100 : null,
      buyoutPct: orders > 0 ? buyouts / orders * 100 : null,
      marginPerUnit: margin != null && orders > 0 ? margin / orders : null,
      marginBeforeDrrPct: marginBeforeAd != null && revenue > 0 ? marginBeforeAd / revenue * 100 : null,
      marginAfterDrrPct: margin != null && revenue > 0 ? margin / revenue * 100 : null,
    };
  }).sort((a, b) => b.revenue - a.revenue);
}
