"use client";

import { useEffect, useState } from "react";
import type { AssortmentDirection } from "@/lib/assortment/constants";
import type { AssortmentSource } from "@/lib/assortment/coverage";

export type SourcesState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; sources: AssortmentSource[] };

/** Паспорт источников раздела или всего модуля (direction = null). */
export function useAssortmentSources(direction: AssortmentDirection | null): SourcesState {
  const [state, setState] = useState<SourcesState>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    const query = direction ? `?direction=${direction}` : "";
    fetch(`/api/assortment-development/sources${query}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) {
          setState({ kind: "error", message: body?.error || `Не удалось загрузить источники (${response.status})` });
          return;
        }
        setState({ kind: "ready", sources: Array.isArray(body?.sources) ? body.sources : [] });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error", message: "Нет связи с сервером" });
      });
    return () => {
      cancelled = true;
    };
  }, [direction]);
  return state;
}
