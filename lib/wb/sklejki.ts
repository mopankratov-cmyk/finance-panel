import { getWbCommissionForCabinet, resolveWbRatesForNm, type WbCommission } from "./commissions";

export async function loadSklejkiCommissionForCabinet(
  cabinetId: string,
  loader: typeof getWbCommissionForCabinet = getWbCommissionForCabinet,
): Promise<WbCommission> {
  return loader(cabinetId, 30, { allowLiveFallback: false });
}

export interface SklejkiSkuMetrics {
  nm: number;
  art: string;
  name: string;
  img_url: string;
  shop: string;
  shows_7d: number;
  orders_count_7d: number;
  orders_sum_7d: number;
  adv_spend_7d: number;
  adv_spend_14d: number;
  sales_calc_7d?: number;
  drr_7d: number | null;
  margin_before_drr: number | null;
  stock: number;
  signal: string | null;
  nm_rating: number | null;
  nm_feedbacks: number | null;
}

export interface SklejkiGroup {
  imt_id: number;
  shop_label: string;
  category_label: string;
  valuation?: number | null;
  feedback_count?: number;
  hide_group_rating?: boolean;
  skus: SklejkiSkuMetrics[];
}

export interface SklejkiPayload {
  groups_multi: SklejkiGroup[];
  groups_solo: SklejkiGroup[];
  total_sku: number;
  multi_groups: number;
  solo_skus: number;
  covered: number;
}

export function calculateMarginBeforeDrrPct(input: {
  price: number;
  cost: number | null | undefined;
  warehouseExpenses: number | null | undefined;
  marketplacePct: number;
  acquiringPct: number;
  ratesFactual: boolean;
  taxPct?: number;
}): number | null {
  const { price, cost, marketplacePct, acquiringPct, ratesFactual } = input;
  const taxPct = input.taxPct ?? 7;
  if (!Number.isFinite(price) || price <= 0
    || cost == null || !Number.isFinite(cost) || cost <= 0
    || !ratesFactual
    || !Number.isFinite(marketplacePct) || marketplacePct < 0
    || !Number.isFinite(acquiringPct) || acquiringPct < 0
    || !Number.isFinite(taxPct) || taxPct < 0
    || (input.warehouseExpenses != null && Number.isFinite(input.warehouseExpenses) && input.warehouseExpenses < 0)) {
    return null;
  }
  const warehouseExpenses = input.warehouseExpenses == null || !Number.isFinite(input.warehouseExpenses)
    ? 0
    : input.warehouseExpenses;
  return 100 * (price - cost - warehouseExpenses) / price
    - marketplacePct
    - acquiringPct
    - taxPct;
}

export function mapSklejkiMarginBeforeDrr(input: {
  nmId: number;
  article: string;
  price: number;
  cost: number | null | undefined;
  warehouseExpensesByArticle: ReadonlyMap<string, number>;
  commission: WbCommission;
}): { warehouseExpenses: number; marginBeforeDrrPct: number | null } {
  const warehouseExpenses = input.warehouseExpensesByArticle.get(input.article) ?? 0;
  const rates = resolveWbRatesForNm(input.commission, input.nmId);
  return {
    warehouseExpenses,
    marginBeforeDrrPct: calculateMarginBeforeDrrPct({
      price: input.price,
      cost: input.cost,
      warehouseExpenses,
      marketplacePct: rates.marketplacePct,
      acquiringPct: rates.acquiringPct,
      ratesFactual: rates.factual,
    }),
  };
}

export function mergeSklejkiPayloads(payloads: SklejkiPayload[]): SklejkiPayload {
  const groups_multi = payloads.flatMap((payload) => payload.groups_multi);
  const groups_solo = payloads.flatMap((payload) => payload.groups_solo);
  return {
    groups_multi,
    groups_solo,
    total_sku: payloads.reduce((sum, payload) => sum + payload.total_sku, 0),
    multi_groups: groups_multi.length,
    solo_skus: groups_solo.length,
    covered: payloads.reduce((sum, payload) => sum + payload.covered, 0),
  };
}

export type GlueVerdictKind = "green" | "red" | "amber" | "gray" | "slate";

export interface GlueVerdict {
  tag: string;
  kind: GlueVerdictKind;
  action: string;
  share: number;
}

const number = (value: number | null | undefined) => Number(value || 0);

// Правила Inferno: несущие определяются по доле показов, а рекламные решения —
// по заказам, ДРР и расходу за 14 дней.
export function glueVerdict(group: SklejkiGroup, sku: SklejkiSkuMetrics): GlueVerdict {
  const orders = number(sku.orders_sum_7d);
  const shows = number(sku.shows_7d);
  const drr = sku.drr_7d == null ? null : Number(sku.drr_7d);
  const spend14 = sku.adv_spend_14d == null ? null : Number(sku.adv_spend_14d);
  const orderSum = group.skus.reduce((sum, item) => sum + number(item.orders_sum_7d), 0);
  const showSum = group.skus.reduce((sum, item) => sum + number(item.shows_7d), 0);
  const orderShare = orderSum > 0 ? orders / orderSum : 0;
  const showShare = showSum > 0 ? shows / showSum : 0;
  const hasAds = (drr != null && drr > 0) || (spend14 != null && spend14 > 0);
  const share = Math.round(showShare * 100);
  const spendSuffix = spend14 != null && spend14 > 0
    ? ` · ${Math.round(spend14).toLocaleString("ru-RU")}₽ рекл/14д`
    : "";

  if (showShare >= 0.35) {
    return { tag: "Несущая", kind: "green", action: `держит показы склейки — рекламу ОСТАВИТЬ${spendSuffix}`, share };
  }
  if (hasAds && orders < 300 && orderShare < 0.05) {
    return { tag: "Сливает бюджет", kind: "red", action: `реклама идёт, заказов нет — ОТКЛЮЧИТЬ${spendSuffix}`, share };
  }
  if (hasAds && drr != null && drr > 25) {
    const loss = drr > 100;
    return {
      tag: loss ? "Убыточная реклама" : "Дорогая реклама",
      kind: "amber",
      action: `ДРР ${drr}% ${loss ? "(реклама дороже выручки!) " : ""}— снизить ставку, не отключать (заказы есть)${spendSuffix}`,
      share,
    };
  }
  if (!hasAds && orders < 300 && (showSum === 0 || shows < showSum * 0.03)) {
    return { tag: "Балласт", kind: "gray", action: "без рекламы, копит отзывы", share };
  }
  return { tag: "Средняя", kind: "slate", action: `вносит вклад${spendSuffix}`, share };
}

export function glueSummary(group: SklejkiGroup) {
  const summary = { carry: 0, drain: 0, expensive: 0, ballast: 0 };
  for (const sku of group.skus) {
    const kind = glueVerdict(group, sku).kind;
    if (kind === "green") summary.carry += 1;
    else if (kind === "red") summary.drain += 1;
    else if (kind === "amber") summary.expensive += 1;
    else if (kind === "gray") summary.ballast += 1;
  }
  return summary;
}

export function glueTotals(group: SklejkiGroup) {
  const totals = group.skus.reduce((result, sku) => ({
    shows: result.shows + number(sku.shows_7d),
    orders_count: result.orders_count + number(sku.orders_count_7d),
    orders_sum: result.orders_sum + number(sku.orders_sum_7d),
    spend: result.spend + number(sku.adv_spend_7d),
    sales: result.sales + number(sku.sales_calc_7d),
  }), { shows: 0, orders_count: 0, orders_sum: 0, spend: 0, sales: 0 });
  const denominator = totals.sales || totals.orders_sum;
  return {
    ...totals,
    drr: denominator > 0 ? Math.round((totals.spend / denominator) * 1_000) / 10 : totals.spend > 0 ? null : 0,
  };
}

export function glueSortedSkus(group: SklejkiGroup) {
  return [...group.skus].sort((a, b) => number(b.shows_7d) - number(a.shows_7d) || number(b.orders_sum_7d) - number(a.orders_sum_7d));
}

function glueGroupSortKey(group: SklejkiGroup) {
  const totals = glueTotals(group);
  const summary = glueSummary(group);
  const activeSkuCount = group.skus.filter((sku) =>
    number(sku.shows_7d) > 0
    || number(sku.orders_sum_7d) > 0
    || number(sku.adv_spend_7d) > 0
    || number(sku.adv_spend_14d) > 0
  ).length;
  const activityRank = summary.carry > 0
    ? 3
    : totals.orders_sum > 0
      ? 2
      : totals.shows > 0 || totals.spend > 0
        ? 1
        : 0;
  return {
    activityRank,
    carry: summary.carry,
    activeSkuCount,
    orders_sum: totals.orders_sum,
    shows: totals.shows,
    spend: totals.spend,
    skuCount: group.skus.length,
    imt: group.imt_id,
  };
}

export function glueSortedGroups(groups: SklejkiGroup[]) {
  return groups
    .map((group) => ({ group, key: glueGroupSortKey(group) }))
    .sort((a, b) =>
      b.key.activityRank - a.key.activityRank
      || b.key.carry - a.key.carry
      || b.key.orders_sum - a.key.orders_sum
      || b.key.shows - a.key.shows
      || b.key.spend - a.key.spend
      || b.key.activeSkuCount - a.key.activeSkuCount
      || b.key.skuCount - a.key.skuCount
      || a.key.imt - b.key.imt
    )
    .map(({ group }) => group);
}

export function closedMoscowDates(days: number, nowMs = Date.now()): string[] {
  const moscowNow = new Date(nowMs + 3 * 60 * 60 * 1_000);
  moscowNow.setUTCHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(moscowNow);
    day.setUTCDate(day.getUTCDate() - index - 1);
    return day.toISOString().slice(0, 10);
  }).reverse();
}

export function sklejkiPeriod(nowMs = Date.now()) {
  const dates = closedMoscowDates(7, nowMs);
  const label = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
  return `${label(dates[0])}–${label(dates[dates.length - 1])}`;
}
