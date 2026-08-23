"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchOzonCockpitJson } from "@/lib/ozon/clientFetch";
import { useOzonCabinet } from "./OzonCabinetContext";

export function useOzonCockpit<T>(
  view: string,
  period: { from: string; to: string } | number = 14,
  extra: Record<string, string | number> = {},
) {
  // Разбираем период на примитивы: объект пересоздаётся на каждый рендер, и
  // эффект, зависящий от него, перезапрашивал бы Ozon бесконечно.
  const from = typeof period === "number" ? null : period.from;
  const to = typeof period === "number" ? null : period.to;
  const days = typeof period === "number" ? period : null;
  const { cabinetId, ready } = useOzonCabinet();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const forceRefreshRef = useRef(false);
  const extraKey = JSON.stringify(extra);

  useEffect(() => {
    if (!ready || !cabinetId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ view, cabinet: cabinetId });
    // Границы календаря отправляем как есть; число дней остаётся для экранов,
    // которым период не выбирают.
    if (from && to) { params.set("from", from); params.set("to", to); }
    else params.set("days", String(days ?? 14));
    if (forceRefreshRef.current) {
      params.set("refresh", "1");
      forceRefreshRef.current = false;
    }
    const stableExtra = JSON.parse(extraKey) as Record<string, string | number>;
    for (const [key, value] of Object.entries(stableExtra)) params.set(key, String(value));
    fetchOzonCockpitJson<T>(`/api/ozon/cockpit?${params.toString()}`, controller.signal)
      .then(setData)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить Ozon");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [cabinetId, days, extraKey, from, to, ready, reloadKey, view]);

  const refresh = useCallback(() => {
    forceRefreshRef.current = true;
    setReloadKey((key) => key + 1);
  }, []);
  return { data, loading, error, refresh };
}
