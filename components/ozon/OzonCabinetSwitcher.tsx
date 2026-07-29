"use client";

import { Building2, Check, ChevronDown, Layers3, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useOzonCabinet } from "./OzonCabinetContext";

export function OzonCabinetSwitcher() {
  const { cabinets, groups, cabinetId, activeCabinet, activeGroup, loading, error, canUseAll, setCabinetId, refreshCabinets } = useOzonCabinet();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  const label = cabinetId === "all" ? "Все кабинеты" : activeGroup?.name ?? activeCabinet?.name ?? "Кабинет Ozon";
  const choose = (value: string) => {
    setCabinetId(value);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-11 min-w-[150px] items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-2.5 text-left text-[11px] font-semibold text-sky-800 transition hover:border-sky-300 hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 sm:h-8 sm:min-w-[168px]"
      >
        <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
          {cabinetId === "all" || activeGroup ? <Layers3 className="h-3.5 w-3.5" /> : <Building2 className="h-3.5 w-3.5" />}
          {!loading && !error && <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-1 ring-sky-50" />}
        </span>
        <span className="min-w-0 flex-1 truncate">{loading ? "Загрузка кабинетов…" : label}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div role="listbox" aria-label="Кабинет Ozon" className="absolute right-0 z-[80] mt-1.5 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.16)]">
          <div className="border-b border-slate-100 px-3 py-2">
            <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">Кабинет данных</div>
            <div className="mt-0.5 text-[11px] text-slate-500">Меняет срез на всех экранах Ozon</div>
          </div>
          <div className="max-h-72 overflow-y-auto p-1.5">
            {canUseAll && cabinets.length > 1 && (
              <Option selected={cabinetId === "all"} label="Все кабинеты" icon={<Layers3 className="h-4 w-4" />} onClick={() => choose("all")} />
            )}
            {cabinets.map((cabinet) => (
              <Option
                key={cabinet.id}
                selected={cabinet.id === cabinetId}
                label={cabinet.name}
                sublabel={cabinet.client_id || cabinet.seller_id || "Ozon Seller"}
                icon={<Building2 className="h-4 w-4" />}
                onClick={() => choose(cabinet.id)}
              />
            ))}
            {groups.length > 0 && <div className="mx-2 mt-1 border-t border-slate-100 px-0 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">Группы</div>}
            {groups.map((group) => (
              <Option
                key={group.id}
                selected={cabinetId === `group:${group.id}`}
                label={group.name}
                sublabel={`${group.memberIds.length} кабинета`}
                icon={<Layers3 className="h-4 w-4" />}
                onClick={() => choose(`group:${group.id}`)}
              />
            ))}
            {!loading && cabinets.length === 0 && <div className="px-2.5 py-4 text-center text-xs text-slate-400">{error || "Нет доступных Ozon-кабинетов"}</div>}
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/80 px-3 py-2">
            <span className="text-[10px] text-slate-400">{cabinets.length} подключено</span>
            <button type="button" onClick={refreshCabinets} className="inline-flex min-h-11 items-center gap-1 px-2 text-[10px] font-semibold text-slate-500 hover:text-sky-700 sm:min-h-8">
              <RefreshCw className="h-3 w-3" /> Обновить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Option({ selected, label, sublabel, icon, onClick }: { selected: boolean; label: string; sublabel?: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" role="option" aria-selected={selected} onClick={onClick} className={`flex min-h-11 w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left ${selected ? "bg-sky-50 text-sky-800" : "text-slate-600 hover:bg-slate-50"}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold">{label}</span>
        {sublabel && <span className="mt-0.5 block truncate text-[10px] text-slate-400">{sublabel}</span>}
      </span>
      {selected && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
    </button>
  );
}
