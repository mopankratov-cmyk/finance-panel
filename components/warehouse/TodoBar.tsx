"use client";

import { AlertTriangle, Check, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { WarehouseTodo } from "@/app/api/warehouse/todo/route";

/** Что требует рук — до того, как человек начнёт искать это по вкладкам.
 *  Каждое дело кликабельно и уводит туда, где его закрывают. */
export function TodoBar({
  entityId,
  refreshKey,
  onGo,
}: {
  entityId: string;
  refreshKey: number;
  onGo: (tab: WarehouseTodo["tab"]) => void;
}) {
  const [items, setItems] = useState<WarehouseTodo[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    fetch(`/api/warehouse/todo?entity=${encodeURIComponent(entityId)}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => { if (!cancelled) setItems(json.data?.items ?? []); })
      // Молча: полоса дел — подсказка, а не отчёт. Своей ошибкой она не должна
      // занимать место над экраном, ради которого человек сюда пришёл.
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [entityId, refreshKey]);

  if (items === null) return <div className="mb-4 h-9" />;

  if (items.length === 0) {
    return (
      <div className="mb-4 flex items-center gap-1.5 text-sm text-slate-400">
        <Check className="h-3.5 w-3.5" />
        Дел нет
      </div>
    );
  }

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {items.map((item) => (
        <button
          key={item.key}
          onClick={() => onGo(item.tab)}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
            item.tone === "danger"
              ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
              : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
          }`}
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {item.label}
          <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </button>
      ))}
    </div>
  );
}
