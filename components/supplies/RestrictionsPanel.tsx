"use client";

import { useState } from "react";
import { ShieldAlert, RefreshCw } from "lucide-react";
import type { RestrictionRow } from "@/app/api/supplies/check-restrictions/route";

const STATUS_STYLE: Record<RestrictionRow["status"], string> = {
  closed: "text-red-600",
  paid: "text-amber-600",
  free: "text-emerald-600",
};
const STATUS_LABEL: Record<RestrictionRow["status"], string> = {
  closed: "приёмка закрыта",
  paid: "платно",
  free: "бесплатно",
};

// Официальный WB Tariffs API (не WMS/МойСклад) — коэффициенты приёмки складов.
export function RestrictionsPanel({ cabinetId, onRows }: { cabinetId: string; onRows?: (rows: RestrictionRow[]) => void }) {
  const [rows, setRows] = useState<RestrictionRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/supplies/check-restrictions?cabinet=${cabinetId}`, { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) setError(json.error || "Ошибка");
      else {
        const nextRows = (json.rows ?? []) as RestrictionRow[];
        setRows(nextRows);
        onRows?.(nextRows);
      }
    } catch (e) {
      setError("Сеть: " + String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="col-span-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs text-slate-400"><ShieldAlert className="h-3.5 w-3.5" /> Ограничения приёмки складов</p>
        <button onClick={check} disabled={loading} className="flex items-center gap-1 text-xs text-violet-600 hover:underline disabled:opacity-50">
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Проверить
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {rows && !error && (
        rows.length ? (
          <div className="max-h-32 space-y-1 overflow-y-auto">
            {rows.map((r) => (
              <div key={r.warehouse} className="flex justify-between text-sm">
                <span className="text-slate-600 truncate">{r.warehouse}</span>
                <span className={`font-medium ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}{r.status === "paid" ? ` ×${r.coefficient}` : ""}</span>
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-slate-400">Нет данных.</p>
      )}
      {!rows && !error && <p className="text-xs text-slate-400">Нажми «Проверить» — реальный запрос к тарифам WB.</p>}
    </div>
  );
}
