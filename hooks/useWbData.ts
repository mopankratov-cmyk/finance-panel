"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchAllWbData } from "@/lib/wb/client";
import type { WbAdCount, WbAdStat, WbOrder, WbReportRow, WbStock } from "@/lib/wb/types";

interface WbDataState {
  sales: WbReportRow[];
  orders: WbOrder[];
  stocks: WbStock[];
  ads: WbAdCount | null;
  adStats: WbAdStat[];
  error: string | null;
  timestamp: string;
  loading: boolean;
}

export function useWbData(dateFrom: string, dateTo: string) {
  const [state, setState] = useState<WbDataState>({
    sales: [],
    orders: [],
    stocks: [],
    ads: null,
    adStats: [],
    error: null,
    timestamp: "",
    loading: true,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    const result = await fetchAllWbData(dateFrom, dateTo);
    setState({
      sales: result.sales,
      orders: result.orders,
      stocks: result.stocks,
      ads: result.ads,
      adStats: result.adStats,
      error: result.error,
      timestamp: result.timestamp,
      loading: false,
    });
  }, [dateFrom, dateTo]);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, refresh: load };
}
