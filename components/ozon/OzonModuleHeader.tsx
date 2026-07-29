"use client";

import { CalendarDays, RefreshCw } from "lucide-react";

export function OzonModuleHeader({
  eyebrow,
  title,
  subtitle,
  days,
  onDaysChange,
  onRefresh,
  refreshing,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  days?: number;
  onDaysChange?: (days: number) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-sky-600">{eyebrow}</div>
          <h1 className="mt-0.5 text-xl font-bold tracking-tight text-slate-900">{title}</h1>
          <p className="mt-0.5 max-w-3xl text-xs text-slate-500">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {days && onDaysChange && (
            <div className="flex h-11 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 sm:h-8">
              <CalendarDays className="ml-1 h-3.5 w-3.5 text-slate-400" />
              {[7, 14, 30].map((value) => (
                <button key={value} type="button" onClick={() => onDaysChange(value)} className={`h-8 rounded-md px-2 text-[11px] font-semibold transition sm:h-6 ${days === value ? "bg-white text-sky-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>{value} дн.</button>
              ))}
            </div>
          )}
          {onRefresh && (
            <button type="button" onClick={onRefresh} disabled={refreshing} className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 hover:border-sky-200 hover:text-sky-700 disabled:cursor-wait disabled:opacity-60 sm:h-8">
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Обновить
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
