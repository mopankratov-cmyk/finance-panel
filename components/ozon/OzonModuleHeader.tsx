"use client";

import { RefreshCw } from "lucide-react";
import { PeriodRangePicker } from "@/components/ui/PeriodRangePicker";
import { OZON_PERIOD_PRESETS } from "@/lib/ozon/period";

export function OzonModuleHeader({
  eyebrow,
  title,
  subtitle,
  period,
  preset,
  onApplyPreset,
  onApplyRange,
  onRefresh,
  refreshing,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  /** Период показывается календарём — как в РНП Wildberries: пресеты слева, два месяца справа. */
  period?: { from: string; to: string; days?: number; clamped?: boolean };
  preset?: string;
  onApplyPreset?: (value: string) => void;
  onApplyRange?: (from: string, to: string) => void;
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
          {/* Период молча укорачивался с начала — человек выбирал полгода и
              получал квартал без единого слова. Говорим об этом там же, где
              он выбирал. */}
          {period?.clamped && (
            <p className="mt-1 text-[11px] font-semibold text-amber-700">
              Показан максимум {period.days} дн. до {period.to}: аналитика Ozon отдаётся построчно «товар × день», и более длинный период не успевает доехать.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {period && onApplyPreset && onApplyRange && (
            <PeriodRangePicker
              from={period.from}
              to={period.to}
              presets={OZON_PERIOD_PRESETS}
              activePreset={preset}
              align="right"
              onApplyPreset={onApplyPreset}
              onApplyRange={onApplyRange}
            />
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
