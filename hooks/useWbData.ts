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

async function fetchFromCache(
  dateFrom: string,
  dateTo: string,
): Promise<Omit<WbDataState, "loading" | "syncing">> {
  const res = await fetch(
    `/api/wb/cache?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`,
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Ошибка чтения кэша (${res.status})`);
  }
  return res.json();
}

export function useWbData(dateFrom: string, dateTo: string) {
  const [state, setState] = useState<WbDataState>(EMPTY_STATE);
  const loadingRef = useRef(false);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      if (!opts?.silent) {
        setState((s) => ({ ...s, loading: true, error: null }));
      }

      try {
        const data = await fetchFromCache(dateFrom, dateTo);
        setState((s) => ({
          ...data,
          loading: false,
          syncing: false,
          error: null,
        }));
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
    [dateFrom, dateTo],
  );

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, syncing: true, error: null }));
    try {
      const res = await fetch("/api/cron/wb-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateFrom, dateTo }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Ошибка синхронизации (${res.status})`);
      }
      await load({ silent: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Не удалось обновить данные";
      setState((s) => ({ ...s, syncing: false, error: msg }));
    }
  }, [load, dateFrom, dateTo]);

  useEffect(() => {
    void load();
  }, [load]);

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
