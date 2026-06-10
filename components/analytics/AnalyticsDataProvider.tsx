"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  WbAdStat,
  WbAdvertsResponse,
  WbOrder,
  WbReportRow,
  WbStock,
} from "@/lib/wb/types";

const STALE_MS = 60 * 60 * 1000;
const STALE_CHECK_MS = 60_000;

export interface WbRawData {
  sales: WbReportRow[];
  orders: WbOrder[];
  stocks: WbStock[];
  ads: WbAdvertsResponse | null;
  adStats: WbAdStat[];
  error: string | null;
  empty: boolean;
  timestamp: string;
}

interface AnalyticsDataContextValue {
  /** Данные для вкладки «Продажи» */
  sales: WbRawData | null;
  /** Данные для вкладки «Товары» / «Склад» */
  products: WbRawData | null;
  /** Данные для вкладки «Реклама» */
  ads: WbRawData | null;
  loading: boolean;
  syncing: boolean;
  refresh: () => Promise<void>;
}

const AnalyticsDataContext = createContext<AnalyticsDataContextValue | null>(
  null,
);

async function fetchWbData(refresh: boolean): Promise<WbRawData> {
  const url = refresh ? "/api/wb/data?refresh=1" : "/api/wb/data";
  const res = await fetch(url, refresh ? { cache: "no-store" } : undefined);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Ошибка загрузки (${res.status})`);
  }
  return res.json();
}

export function AnalyticsDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<WbRawData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const fetchedAtRef = useRef<number | null>(null);
  const hasLoadedRef = useRef(false);
  const loadingRef = useRef(false);

  const load = useCallback(async (opts?: { silent?: boolean; refresh?: boolean }) => {
    if (loadingRef.current) return;
    loadingRef.current = true;

    const isInitial = !hasLoadedRef.current && !opts?.silent;
    if (isInitial) {
      setLoading(true);
    } else if (opts?.refresh) {
      setSyncing(true);
    }

    try {
      const next = await fetchWbData(opts?.refresh === true);
      setData(next);
      hasLoadedRef.current = true;
      fetchedAtRef.current = Date.now();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Не удалось загрузить данные";
      setData((prev) =>
        prev
          ? { ...prev, error: msg }
          : {
              sales: [],
              orders: [],
              stocks: [],
              ads: null,
              adStats: [],
              empty: true,
              error: msg,
              timestamp: "",
            },
      );
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setSyncing(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    await load({ silent: true, refresh: true });
  }, [load]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch once on mount
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (
        fetchedAtRef.current &&
        Date.now() - fetchedAtRef.current > STALE_MS &&
        !loadingRef.current
      ) {
        void load({ silent: true, refresh: true });
      }
    }, STALE_CHECK_MS);
    return () => clearInterval(id);
  }, [load]);

  const value: AnalyticsDataContextValue = {
    sales: data,
    products: data,
    ads: data,
    loading,
    syncing,
    refresh,
  };

  return (
    <AnalyticsDataContext.Provider value={value}>
      {children}
    </AnalyticsDataContext.Provider>
  );
}

export function useAnalyticsData() {
  const ctx = useContext(AnalyticsDataContext);
  if (!ctx) {
    throw new Error("useAnalyticsData must be used within AnalyticsDataProvider");
  }
  return ctx;
}
