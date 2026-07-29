import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requestAllowedNmIds, requestAllowsNm } from "@/lib/wb/requestProductScope";
import { loadRnpReportRows } from "@/lib/rnp/rpcLoaders";

export interface RnpPeriodMetrics {
  ordersCount: number;
  ordersSum: number;
  buyoutsCount: number;
  buyoutsSum: number;
}

export interface RnpRow {
  nmId: number;
  article: string;
  periods: {
    today: RnpPeriodMetrics;
    yesterday: RnpPeriodMetrics;
    week: RnpPeriodMetrics;
    month: RnpPeriodMetrics;
  };
  stock: number;
  inWayToClient: number;
  /** остаток ÷ ср. дневные заказы за 30 дней */
  turnoverDays: number | null;
  cost: number | null;
  /** остаток × себестоимость */
  stockMoney: number | null;
  /** расход рекламы за 30 дней */
  adSpend: number;
  /** ДРР = расход ÷ заказы ₽ за 30 дней */
  drr: number | null;
}

interface RpcRow {
  nm_id: number;
  article: string;
  orders_today: number; orders_sum_today: number;
  orders_yesterday: number; orders_sum_yesterday: number;
  orders_week: number; orders_sum_week: number;
  orders_month: number; orders_sum_month: number;
  buyouts_today: number; buyouts_sum_today: number;
  buyouts_yesterday: number; buyouts_sum_yesterday: number;
  buyouts_week: number; buyouts_sum_week: number;
  buyouts_month: number; buyouts_sum_month: number;
  stock: number;
  in_way_to_client: number;
  cost: number | null;
  ad_spend_month: number | null;
}

export async function buildRnpReport(cabinetId?: string | null): Promise<RnpRow[]> {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase не настроен");

  const allowedNmIds = await requestAllowedNmIds(cabinetId || null);
  const rpcRows = (await loadRnpReportRows<RpcRow>(db, cabinetId || null, {
    allowedNmIds,
    label: "RNP: отчёт",
  })).filter((row) => requestAllowsNm(allowedNmIds, row.nm_id));

  const rows: RnpRow[] = rpcRows.map((r) => {
    const monthSum = Number(r.orders_sum_month);
    const avgDaily = r.orders_month / 30;
    // реальный расход рекламы по nm_id за 30 дней (этап 4)
    const adSpend = Number(r.ad_spend_month ?? 0);
    return {
      nmId: r.nm_id,
      article: r.article,
      periods: {
        today: {
          ordersCount: r.orders_today,
          ordersSum: Number(r.orders_sum_today),
          buyoutsCount: r.buyouts_today,
          buyoutsSum: Number(r.buyouts_sum_today),
        },
        yesterday: {
          ordersCount: r.orders_yesterday,
          ordersSum: Number(r.orders_sum_yesterday),
          buyoutsCount: r.buyouts_yesterday,
          buyoutsSum: Number(r.buyouts_sum_yesterday),
        },
        week: {
          ordersCount: r.orders_week,
          ordersSum: Number(r.orders_sum_week),
          buyoutsCount: r.buyouts_week,
          buyoutsSum: Number(r.buyouts_sum_week),
        },
        month: {
          ordersCount: r.orders_month,
          ordersSum: monthSum,
          buyoutsCount: r.buyouts_month,
          buyoutsSum: Number(r.buyouts_sum_month),
        },
      },
      stock: Number(r.stock),
      inWayToClient: Number(r.in_way_to_client),
      turnoverDays: avgDaily > 0 ? Math.round(Number(r.stock) / avgDaily) : null,
      cost: r.cost !== null ? Number(r.cost) : null,
      stockMoney: r.cost !== null ? Number(r.stock) * Number(r.cost) : null,
      adSpend,
      drr: adSpend > 0 && monthSum > 0 ? (adSpend / monthSum) * 100 : null,
    };
  });

  return rows.sort((a, b) => b.periods.month.ordersSum - a.periods.month.ordersSum);
}
