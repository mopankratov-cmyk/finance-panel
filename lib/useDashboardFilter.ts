"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function readDashboardFilter<T extends string>(params: Pick<URLSearchParams, "get">, key: string, fallback: T, allowed?: readonly T[]): T {
  const raw = params.get(key);
  if (raw == null || raw === "") return fallback;
  if (allowed && !allowed.includes(raw as T)) return fallback;
  return raw as T;
}

export function writeDashboardFilter(params: URLSearchParams, key: string, value: string, fallback: string) {
  if (!value || value === fallback) params.delete(key);
  else params.set(key, value);
  return params;
}

/** Keeps a dashboard filter shareable without causing a Next.js navigation on every keystroke. */
export function useDashboardFilter<T extends string>(key: string, fallback: T, allowed?: readonly T[], debounceMs = 0) {
  const searchParams = useSearchParams();
  const initial = useRef<T | null>(null);
  const fallbackRef = useRef(fallback);
  if (initial.current == null) initial.current = readDashboardFilter(searchParams, key, fallback, allowed);
  const [value, setValue] = useState<T>(initial.current);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const url = new URL(window.location.href);
      writeDashboardFilter(url.searchParams, key, value, fallbackRef.current);
      const next = `${url.pathname}${url.search}${url.hash}`;
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (next !== current) window.history.replaceState(window.history.state, "", next);
    }, debounceMs);
    return () => window.clearTimeout(timer);
  }, [debounceMs, key, value]);

  return [value, setValue] as const;
}
