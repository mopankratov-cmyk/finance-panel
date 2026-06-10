"use client";

import { useMemo } from "react";
import { useAnalyticsData } from "@/components/analytics/AnalyticsDataProvider";
import type { WbReportRow, WbOrder } from "@/lib/wb/types";

function saleDate(row: WbReportRow): string {
  return String(row.sale_dt ?? row.order_dt ?? row.create_dt ?? "").slice(0, 10);
}

function filterForRange<T extends WbReportRow | WbOrder>(
  rows: T[],
  dateFrom: string,
  dateTo: string,
  getDate: (row: T) => string,
): T[] {
  return rows.filter((row) => {
    const d = getDate(row);
    return d >= dateFrom && d <= dateTo;
  });
}

export function useWbData(dateFrom: string, dateTo: string) {
  const { sales: raw, loading, syncing, refresh } = useAnalyticsData();

  const filtered = useMemo(() => {
    if (!raw) {
      return {
        sales: [] as WbReportRow[],
        orders: [] as WbOrder[],
        stocks: [],
        ads: null,
        adStats: [],
        error: null,
        empty: true,
        timestamp: "",
      };
    }

    const sales = filterForRange(raw.sales, dateFrom, dateTo, saleDate);
    const orders = filterForRange(
      raw.orders,
      dateFrom,
      dateTo,
      (o) => (o.date ?? "").slice(0, 10),
    );
    const hasData = !!(
      sales.length ||
      orders.length ||
      raw.stocks.length ||
      raw.ads ||
      raw.adStats.length
    );

    return {
      sales,
      orders,
      stocks: raw.stocks,
      ads: raw.ads,
      adStats: raw.adStats,
      error: raw.error,
      empty: !hasData,
      timestamp: raw.timestamp,
    };
  }, [raw, dateFrom, dateTo]);

  return {
    ...filtered,
    loading,
    syncing,
    refresh,
  };
}
