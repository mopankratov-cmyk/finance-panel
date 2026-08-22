"use client";

import { useEffect, useState } from "react";

/**
 * Справочник «nm → артикул + название карточки WB» для экранов, где имена
 * приходят пустыми или падают обратно в артикул (Полки не знают названий
 * вовсе; Воронка и РНП берут имя из себестоимости/PIM-снимка, и у кабинетов
 * без заполненной себестоимости показывают артикул дважды).
 *
 * Источник — /api/pim: реальные заголовки карточек из WB Content API с
 * часовым кэшем. Побочный бонус: первый заход прогревает кэш и для РНП.
 */
export interface WbSkuIdentity {
  article: string;
  name: string;
}

interface PimResponse {
  rows?: Array<{ nmId?: number; article?: string; name?: string }>;
}

export function useWbSkuNames(cabinetId: string | null | undefined) {
  const [names, setNames] = useState<Map<number, WbSkuIdentity>>(new Map());

  useEffect(() => {
    setNames(new Map());
    if (!cabinetId) return;
    const controller = new AbortController();
    fetch(`/api/pim?cabinet=${encodeURIComponent(cabinetId)}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? (response.json() as Promise<PimResponse>) : null)
      .then((body) => {
        if (!body || controller.signal.aborted) return;
        const map = new Map<number, WbSkuIdentity>();
        for (const row of body.rows ?? []) {
          const nm = Number(row.nmId);
          if (!Number.isSafeInteger(nm) || nm <= 0) continue;
          map.set(nm, { article: String(row.article ?? ""), name: String(row.name ?? "") });
        }
        setNames(map);
      })
      // Справочник — вспомогательный слой: без него экран живёт как раньше.
      .catch(() => {});
    return () => controller.abort();
  }, [cabinetId]);

  return names;
}

/**
 * Название для показа рядом с артикулом. Имя, совпадающее с артикулом, — это
 * фолбэк источника, а не название: тогда честнее взять заголовок карточки WB.
 */
export function displaySkuName(article: string, serverName: string | null | undefined, directory: Map<number, WbSkuIdentity>, nm: number) {
  const server = (serverName ?? "").trim();
  if (server && server !== article) return server;
  return directory.get(nm)?.name || "";
}
