"use client";

import { Building2, Check, ChevronDown, Layers3, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useWbCabinet } from "./WbCabinetContext";

export function WbCabinetSwitcher() {
  const {
    cabinets,
    cabinetId,
    activeCabinet,
    loading,
    error,
    canUseAll,
    setCabinetId,
    refreshCabinets,
  } = useWbCabinet();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const label = cabinetId === "all" ? "Все кабинеты" : activeCabinet?.name ?? "Кабинет WB";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-11 min-w-[140px] items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-2.5 text-left text-[11px] font-semibold text-violet-700 transition hover:border-violet-300 hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:h-8 sm:min-w-[154px]"
      >
        <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
          {cabinetId === "all" ? <Layers3 className="h-3.5 w-3.5" /> : <Building2 className="h-3.5 w-3.5" />}
          {!loading && !error && <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-1 ring-violet-50" />}
        </span>
        <span className="min-w-0 flex-1 truncate">{loading ? "Загрузка кабинетов…" : label}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Кабинет Wildberries"
          className="absolute right-0 z-[80] mt-1.5 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.16)]"
        >
          <div className="border-b border-slate-100 px-3 py-2">
            <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">Кабинет данных</div>
            <div className="mt-0.5 text-[11px] text-slate-500">Меняет срез на всех экранах WB</div>
          </div>

          <div className="max-h-72 overflow-y-auto p-1.5">
            {canUseAll && cabinets.length > 1 && (
              <button
                type="button"
                role="option"
                aria-selected={cabinetId === "all"}
                onClick={() => {
                  setCabinetId("all");
                  setOpen(false);
                }}
                className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs ${cabinetId === "all" ? "bg-violet-50 text-violet-700" : "text-slate-600 hover:bg-slate-50"}`}
              >
                <Layers3 className="h-4 w-4 shrink-0" />
                <span className="flex-1 font-semibold">Все кабинеты</span>
                {cabinetId === "all" && <Check className="h-3.5 w-3.5" />}
              </button>
            )}

            {cabinets.map((cabinet) => {
              const selected = cabinet.id === cabinetId;
              return (
                <button
                  key={cabinet.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    setCabinetId(cabinet.id);
                    setOpen(false);
                  }}
                  className={`flex min-h-11 w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left ${selected ? "bg-violet-50 text-violet-700" : "text-slate-600 hover:bg-slate-50"}`}
                >
                  <Building2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">{cabinet.name}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-slate-400">
                      {cabinet.trade_mark || cabinet.inn || "Wildberries"}
                    </span>
                  </span>
                  {selected && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                </button>
              );
            })}

            {!loading && cabinets.length === 0 && (
              <div className="px-2.5 py-4 text-center text-xs text-slate-400">
                {error || "Нет доступных WB-кабинетов"}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/80 px-3 py-2">
            <span className="text-[10px] text-slate-400">{cabinets.length} подключено</span>
            <button
              type="button"
              onClick={refreshCabinets}
              className="inline-flex min-h-11 items-center gap-1 px-2 text-[10px] font-semibold text-slate-500 hover:text-violet-700 sm:min-h-8"
            >
              <RefreshCw className="h-3 w-3" /> Обновить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
