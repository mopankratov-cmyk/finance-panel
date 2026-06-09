import { dateRangeDays } from "@/lib/analytics/format";
import type { DateRange } from "./sales";
import type { WbAdStat } from "@/lib/wb/types";

export interface AdsSummary {
  spend: number;
  orders: number;
  cpo: number;
  drr: number;
  roas: number;
  views: number;
  revenue: number;
}

export function computeAdsSummary(stats: WbAdStat[], totalRevenue: number): AdsSummary {
  const spend = stats.reduce((s, c) => s + (c.sum ?? 0), 0);
  const orders = stats.reduce((s, c) => s + (c.orders ?? 0), 0);
  const views = stats.reduce((s, c) => s + (c.views ?? 0), 0);
  const revenue = stats.reduce((s, c) => s + (c.sum_price ?? 0), 0);

  return {
    spend,
    orders,
    cpo: orders > 0 ? spend / orders : 0,
    drr: totalRevenue > 0 ? (spend / totalRevenue) * 100 : 0,
    roas: spend > 0 ? revenue / spend : 0,
    views,
    revenue,
  };
}

export interface DailyAdPoint {
  date: string;
  spend: number;
  orders: number;
  cpo: number;
}

export function computeDailyAdSpend(stats: WbAdStat[], range: DateRange): DailyAdPoint[] {
  const days = dateRangeDays(range.from, range.to);
  const byDay = new Map<string, { spend: number; orders: number }>();

  for (const stat of stats) {
    for (const day of stat.days ?? []) {
      const d = (day.date ?? "").slice(0, 10);
      if (!d) continue;
      const cur = byDay.get(d) ?? { spend: 0, orders: 0 };
      cur.spend += day.sum ?? 0;
      cur.orders += day.orders ?? 0;
      byDay.set(d, cur);
    }
  }

  return days.map((date) => {
    const d = byDay.get(date) ?? { spend: 0, orders: 0 };
    return {
      date,
      spend: d.spend,
      orders: d.orders,
      cpo: d.orders > 0 ? d.spend / d.orders : 0,
    };
  });
}

export type CampaignVerdict = "scale" | "optimize" | "stop";

export interface CampaignRow {
  id: number;
  name: string;
  type: string;
  status: string;
  spend: number;
  views: number;
  clicks: number;
  ctr: number;
  orders: number;
  revenue: number;
  cpo: number;
  drr: number;
  roas: number;
  verdict: CampaignVerdict;
}

const AD_TYPES: Record<number, string> = {
  4: "Каталог",
  5: "Карточка",
  6: "Поиск",
  7: "Рекомендации",
  8: "Автоматическая",
};

export function computeCampaigns(stats: WbAdStat[], totalRevenue: number): CampaignRow[] {
  return stats.map((s) => {
    const spend = s.sum ?? 0;
    const orders = s.orders ?? 0;
    const revenue = s.sum_price ?? 0;
    const views = s.views ?? 0;
    const clicks = s.clicks ?? 0;
    const drr = totalRevenue > 0 ? (spend / totalRevenue) * 100 : spend > 0 ? 100 : 0;
    const roas = spend > 0 ? revenue / spend : 0;

    let verdict: CampaignVerdict = "optimize";
    if (drr < 15 && roas > 4) verdict = "scale";
    else if (drr > 25 || roas < 2) verdict = "stop";

    return {
      id: s.advertId ?? 0,
      name: s.name ?? `Кампания ${s.advertId}`,
      type: AD_TYPES[(s as { type?: number }).type ?? 8] ?? "Автоматическая",
      status: "активна",
      spend,
      views,
      clicks,
      ctr: views > 0 ? (clicks / views) * 100 : s.ctr ?? 0,
      orders,
      revenue,
      cpo: orders > 0 ? spend / orders : 0,
      drr,
      roas,
      verdict,
    };
  });
}

export function verdictLabel(v: CampaignVerdict): string {
  if (v === "scale") return "🟢 Масштабировать";
  if (v === "optimize") return "🟡 Оптимизировать";
  return "🔴 Остановить";
}
