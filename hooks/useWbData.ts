"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WbAdStat, WbAdvertsResponse, WbOrder, WbReportRow, WbStock } from "@/lib/wb/types";

interface WbDataState {
  sales: WbReportRow[];
  orders: WbOrder[];
  stocks: WbStock[];
  ads: WbAdvertsResponse | null;
  adStats: WbAdStat[];
  error: string | null;
  empty: boolean;
  timestamp: string;
  loading: boolean;
  syncing: boolean;
}

const EMPTY_STATE: WbDataState = {
  sales: [],
  orders: [],
  stocks: [],
  ads: null,
  adStats: [],
  error: null,
  empty: true,
  timestamp: "",
  loading: true,
  syncing: false,
};

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

async function fetchWbData(refresh: boolean): Promise<Omit<WbDataState, "loading" | "syncing">> {
  const url = refresh ? "/api/wb/data?refresh=1" : "/api/wb/data";
  const res = await fetch(url, refresh ? { cache: "no-store" } : undefined);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Ошибка загрузки (${res.status})`);
  }
  return res.json();
}

export function useWbData(dateFrom: string, dateTo: string) {
  const [state, setState] = useState<WbDataState>(EMPTY_STATE);
  const [raw, setRaw] = useState<Omit<WbDataState, "loading" | "syncing"> | null>(null);
  const loadingRef = useRef(false);

  const applyRange = useCallback(
    (data: Omit<WbDataState, "loading" | "syncing">) => {
      const sales = filterForRange(data.sales, dateFrom, dateTo, saleDate);
      const orders = filterForRange(
        data.orders,
        dateFrom,
        dateTo,
        (o) => (o.date ?? "").slice(0, 10),
      );
      const hasData = !!(
        sales.length ||
        orders.length ||
        data.stocks.length ||
        data.ads ||
        data.adStats.length
      );
      setState((s) => ({
        ...s,
        sales,
        orders,
        stocks: data.stocks,
        ads: data.ads,
        adStats: data.adStats,
        error: data.error,
        empty: !hasData,
        timestamp: data.timestamp,
        loading: false,
        syncing: false,
      }));
    },
    [dateFrom, dateTo],
  );

  const load = useCallback(
    async (opts?: { silent?: boolean; refresh?: boolean }) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      if (!opts?.silent) {
        setState((s) => ({ ...s, loading: true, error: null }));
      }

      try {
        const data = await fetchWbData(opts?.refresh === true);
        setRaw(data);
        applyRange(data);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Не удалось загрузить данные";
        setState((s) => ({
          ...s,
          loading: false,
          syncing: false,
          error: msg,
        }));
      } finally {
        loadingRef.current = false;
      }
    },
    [applyRange],
  );

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, syncing: true, error: null }));
    await load({ silent: true, refresh: true });
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (raw) applyRange(raw);
  }, [raw, applyRange]);

  return {
    sales: state.sales,
    orders: state.orders,
    stocks: state.stocks,
    ads: state.ads,
    adStats: state.adStats,
    error: state.error,
    empty: state.empty,
    timestamp: state.timestamp,
    loading: state.loading,
    syncing: state.syncing,
    refresh,
  };
}
