export interface AdvertDayPoint {
  ts: string;
  spend: number;
  clicks: number;
  views: number;
  /** Legacy field from WB Ads stats: attributed revenue, not units. */
  orders: number;
}

export interface AdvertFunnelDayPoint {
  openCard: number | null;
  carts: number | null;
  ordersCount: number | null;
  ordersSum: number | null;
}

export interface AdvertWorkingDaySummary {
  date: string;
  is_complete: boolean;
  views: number | null;
  clicks: number | null;
  ctr: number | null;
  spend: number | null;
  attributed_revenue: number | null;
  attributed_drr: number | null;
  open_card: number | null;
  carts: number | null;
  orders_count: number | null;
  orders_sum: number | null;
  stats_synced_at: string | null;
  stats_age_hours: number | null;
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

export function buildAdvertWorkingDaySummary({
  date,
  adDay,
  funnel,
  statsSyncedAt,
  statsAgeHours,
  isComplete,
}: {
  date: string;
  adDay: AdvertDayPoint | null | undefined;
  funnel: AdvertFunnelDayPoint | null | undefined;
  statsSyncedAt: string | null;
  statsAgeHours: number | null;
  isComplete: boolean;
}): AdvertWorkingDaySummary {
  const views = adDay ? Number(adDay.views ?? 0) : null;
  const clicks = adDay ? Number(adDay.clicks ?? 0) : null;
  const spend = adDay ? Number(adDay.spend ?? 0) : null;
  const attributedRevenue = adDay ? Number(adDay.orders ?? 0) : null;

  return {
    date,
    is_complete: isComplete,
    views,
    clicks,
    ctr: views != null && clicks != null && views > 0 ? roundOne((clicks / views) * 100) : null,
    spend,
    attributed_revenue: attributedRevenue,
    attributed_drr: spend != null && attributedRevenue != null && attributedRevenue > 0
      ? roundOne((spend / attributedRevenue) * 100)
      : null,
    open_card: funnel?.openCard ?? null,
    carts: funnel?.carts ?? null,
    orders_count: funnel?.ordersCount ?? null,
    orders_sum: funnel?.ordersSum ?? null,
    stats_synced_at: statsSyncedAt,
    stats_age_hours: statsAgeHours,
  };
}
