"use client";

import { Package } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AgentInsight } from "@/app/api/agent/insights/route";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Сводка за последнюю неделю — только про поставки (module="supplies"):
// «Новых поставок нет» или список номеров через запятую. Остальные модули
// («Что требует внимания» целиком) — на отдельной странице «AI-агент».
export function InsightsBanner() {
  const [supplyIds, setSupplyIds] = useState<(string | number)[]>([]);
  const [ids, setIds] = useState<number[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/insights", { cache: "no-store" });
      const json = await res.json();
      const weekAgo = Date.now() - WEEK_MS;
      const recent: AgentInsight[] = (json.data ?? []).filter(
        (i: AgentInsight) => !i.is_read && i.module === "supplies" && new Date(i.created_at).getTime() >= weekAgo,
      );
      const merged = new Set<string | number>();
      for (const i of recent) {
        const list = ((i as { data?: { supplyIds?: (string | number)[] } }).data?.supplyIds) ?? [];
        for (const s of list) merged.add(s);
      }
      setSupplyIds([...merged]);
      setIds(recent.map((i) => i.id));
    } catch {
      setSupplyIds([]);
      setIds([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="mx-6 mt-4 flex items-center gap-2 rounded-lg border border-[#e6e9f2] bg-white px-4 py-3 text-sm text-[#1a2138]">
      <Package className="h-4 w-4 shrink-0 text-[#6b7390]" />
      {supplyIds.length ? (
        <span>Новые поставки: {supplyIds.join(", ")}</span>
      ) : (
        <span className="text-[#6b7390]">Новых поставок нет</span>
      )}
      {ids.length > 0 && (
        <button
          type="button"
          onClick={async () => {
            setSupplyIds([]);
            setIds([]);
            try {
              await fetch("/api/agent/insights", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids }),
              });
            } catch {
              // мягкая ошибка — вернётся при следующей загрузке
            }
          }}
          className="ml-auto shrink-0 text-xs text-[#6b7390] hover:text-[#1a2138] underline"
        >
          Скрыть
        </button>
      )}
    </div>
  );
}
