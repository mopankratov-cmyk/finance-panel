"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOzonCabinet } from "./OzonCabinetContext";

export function useOzonCockpit<T>(view: string, days = 14, extra: Record<string, string | number> = {}) {
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
    const params = new URLSearchParams({ view, days: String(days), cabinet: cabinetId });
    if (forceRefreshRef.current) {
      params.set("refresh", "1");
      forceRefreshRef.current = false;
    }
    const stableExtra = JSON.parse(extraKey) as Record<string, string | number>;
    for (const [key, value] of Object.entries(stableExtra)) params.set(key, String(value));
    fetch(`/api/ozon/cockpit?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `Ozon ${response.status}`);
        return body as T;
      })
      .then(setData)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить Ozon");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [cabinetId, days, extraKey, ready, reloadKey, view]);

  const refresh = useCallback(() => {
    forceRefreshRef.current = true;
    setReloadKey((key) => key + 1);
  }, []);
  return { data, loading, error, refresh };
}
