"use client";

import { useCallback, useEffect, useState } from "react";
import { buildSkuOrderIndex } from "@/lib/wb/skuOrder";

// Ручной порядок выдачи артикулов кабинета (настраивается в РНП). Хук общий
// для всех экранов со списками SKU: отдаёт индекс позиции по nm и refresh
// после сохранения порядка. Для «Все кабинеты» порядок не применяется.
export function useCabinetSkuOrder(cabinetId: string | null | undefined) {
  const [nmIds, setNmIds] = useState<number[]>([]);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!cabinetId || cabinetId === "all") {
      setNmIds([]);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/sku-order?cabinet=${encodeURIComponent(cabinetId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as { nmIds?: unknown };
        if (!controller.signal.aborted) {
          setNmIds(Array.isArray(body.nmIds) ? body.nmIds.map(Number).filter((nm) => Number.isInteger(nm) && nm > 0) : []);
        }
      })
      .catch(() => {
        // Порядок — украшение поверх данных: недоступен — экран живёт своим сортом.
      });
    return () => controller.abort();
  }, [cabinetId, version]);

  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  return { orderNmIds: nmIds, orderIndex: buildSkuOrderIndex(nmIds), refreshSkuOrder: refresh };
}
