"use client";

import { useEffect, useState } from "react";

/**
 * Справочник «nm → артикул + название карточки WB» для экранов, где имена
 * приходят пустыми или падают обратно в артикул (Полки не знают названий
 * вовсе; Воронка и РНП берут имя из себестоимости/PIM-снимка, и у кабинетов
 * без заполненной себестоимости показывают артикул дважды).
 *
 * Источник — /api/wb/sku-directory: таблица wb_cards, которую наполняет обход
 * Content API. Раньше брали из /api/pim, но тот держит результат в кэше
 * сборки: кэш не общий между роутами и обнуляется каждым деплоем, поэтому
 * названия то были, то пропадали, а на Полках отсутствовали почти всегда.
 * Чтение таблицы отдаёт их сразу и переживает выкладки.
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
    fetch(`/api/wb/sku-directory?cabinet=${encodeURIComponent(cabinetId)}`, { cache: "no-store", signal: controller.signal })
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

/**
 * Артикул для показа. Ручной артикул Полок важнее: владелец вводит его под
 * свой склад. Но он заполнен далеко не везде, и тогда берём артикул карточки
 * WB — иначе в строке товара оказывается номер вместо артикула.
 */
export function displaySkuArticle(manual: string | null | undefined, directory: Map<number, WbSkuIdentity>, nm: number) {
  const own = (manual ?? "").trim();
  if (own) return own;
  return directory.get(nm)?.article || "";
}
