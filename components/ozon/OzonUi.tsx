"use client";

import { AlertCircle, AlertTriangle, CheckCircle2, Database, Info, PackageOpen } from "lucide-react";
import Link from "next/link";

export const formatNumber = (value: number | null | undefined) => value == null ? "—" : Math.round(value).toLocaleString("ru-RU");
export const formatMoney = (value: number | null | undefined) => value == null ? "—" : `${Math.round(value).toLocaleString("ru-RU")} ₽`;
export const formatPercent = (value: number | null | undefined) => value == null ? "—" : `${value.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
export const formatDateTime = (value: string | null | undefined) => value ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";

export function OzonLoading({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-label="Загрузка данных Ozon" aria-busy="true">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white" />)}
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {Array.from({ length: rows }, (_, index) => <div key={index} className="h-12 animate-pulse border-b border-slate-100 bg-gradient-to-r from-white via-slate-50 to-white last:border-0" />)}
      </div>
    </div>
  );
}

export function OzonError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="flex-1"><div className="font-semibold">Не удалось загрузить данные Ozon</div><div className="mt-1 text-xs text-red-700">{message}</div></div>
        <button type="button" onClick={onRetry} className="min-h-11 rounded-lg border border-red-200 bg-white px-3 text-xs font-semibold hover:bg-red-100 sm:min-h-8">Повторить</button>
      </div>
    </div>
  );
}

/**
 * Ошибка при обновлении уже открытого экрана — полоса над данными, а не вместо
 * них: транзиентный отказ стирал целый рабочий экран и заставлял собирать его
 * заново. Показанные цифры остаются, но помечены как несвежие.
 */
export function OzonStaleNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1">Обновить не удалось, показаны прежние данные. {message}</span>
      <button type="button" onClick={onRetry} className="min-h-11 rounded-lg border border-amber-300 bg-white px-3 text-xs font-semibold hover:bg-amber-100 sm:min-h-8">Ещё раз</button>
    </div>
  );
}

export interface OzonAdCoverageItem {
  cabinet: string;
  periodDays: number;
  historyDays: number;
  coveredDays: number;
  source: "daily" | "window" | "live" | "none";
  complete: boolean;
}

/**
 * Полнота рекламного расхода — рядом с цифрами, а не в примечании.
 *
 * Ноль и «данные ещё не собраны» на экране выглядели одинаково, и нулевой
 * расход завышал прибыль в юнит-экономике. Полное покрытие ничего не рисует:
 * говорить стоит только тогда, когда есть о чём предупредить.
 */
export function OzonAdCoverageNotice({ coverage }: { coverage?: OzonAdCoverageItem[] }) {
  const incomplete = (coverage ?? []).filter((item) => !item.complete);
  if (!incomplete.length) return null;
  return (
    <div role="status" className="flex flex-wrap items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-xs text-sky-900">
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">
        <div className="font-semibold">Рекламный расход собран не полностью</div>
        <ul className="mt-1 space-y-0.5 text-[11px]">
          {incomplete.map((item) => (
            <li key={item.cabinet}>
              {item.cabinet}: {item.source === "none"
                ? item.historyDays === 0
                  ? "расход за сегодня Ozon отдаёт завтра — сравнивать пока не с чем"
                  : "за этот период данных ещё нет, показанные нули не факт"
                : `собрано ${item.coveredDays} из ${item.historyDays} дн. — расход занижен на несобранные дни`}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function OzonWarnings({ warnings }: { warnings?: string[] }) {
  if (!warnings?.length) return null;
  return (
    <details className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
      <summary className="cursor-pointer font-semibold">Часть данных недоступна ({warnings.length})</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">{warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul>
    </details>
  );
}

export function EmptyState({ title, detail, href }: { title: string; detail: string; href?: string }) {
  return (
    <div className="grid min-h-52 place-items-center rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
      <div>
        <PackageOpen className="mx-auto h-7 w-7 text-slate-300" />
        <div className="mt-2 text-sm font-semibold text-slate-700">{title}</div>
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">{detail}</p>
        {href && <Link href={href} className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-sky-700 px-3 text-xs font-semibold text-white hover:bg-sky-800 sm:min-h-8">Открыть настройки</Link>}
      </div>
    </div>
  );
}

export function MetricCard({ label, value, detail, delta, tone = "sky" }: { label: string; value: string; detail?: string; delta?: number | null; tone?: "sky" | "emerald" | "amber" | "red" | "slate" }) {
  const tones = {
    sky: "bg-sky-50 text-sky-700",
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    slate: "bg-slate-100 text-slate-700",
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold text-slate-500">{label}</span>
        {delta != null && <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${delta >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{delta >= 0 ? "+" : ""}{delta}%</span>}
      </div>
      <div className="mt-2 text-[22px] font-bold tracking-tight text-slate-900 tabular-nums">{value}</div>
      {detail && <div className={`mt-2 inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${tones[tone]}`}>{detail}</div>}
    </div>
  );
}

export function ProductCell({ image, name, code, cabinet }: { image?: string | null; name: string; code?: string; cabinet?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-lg border border-slate-200 object-cover" />
      ) : <div className="h-10 w-10 shrink-0 rounded-lg bg-slate-100" />}
      <div className="min-w-0">
        <div className="max-w-[360px] truncate text-xs font-semibold text-slate-800" title={name}>{name}</div>
        <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-slate-400">{code && <span>{code}</span>}{cabinet && <span>{cabinet}</span>}</div>
      </div>
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
    ok: { label: "Норма", className: "bg-emerald-50 text-emerald-700", icon: <CheckCircle2 className="h-3 w-3" /> },
    warning: { label: "Внимание", className: "bg-amber-50 text-amber-700", icon: <AlertTriangle className="h-3 w-3" /> },
    critical: { label: "Критично", className: "bg-red-50 text-red-700", icon: <AlertCircle className="h-3 w-3" /> },
    out: { label: "Нет остатка", className: "bg-red-50 text-red-700", icon: <AlertCircle className="h-3 w-3" /> },
    overstock: { label: "Излишек", className: "bg-indigo-50 text-indigo-700", icon: <Info className="h-3 w-3" /> },
    error: { label: "Ошибка", className: "bg-red-50 text-red-700", icon: <AlertCircle className="h-3 w-3" /> },
    estimated: { label: "Расчёт", className: "bg-sky-50 text-sky-700", icon: <Database className="h-3 w-3" /> },
    missing_cost: { label: "Нет себеса", className: "bg-amber-50 text-amber-700", icon: <AlertTriangle className="h-3 w-3" /> },
  };
  const value = config[status] ?? { label: status || "—", className: "bg-slate-100 text-slate-600", icon: <Info className="h-3 w-3" /> };
  return <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-semibold ${value.className}`}>{value.icon}{value.label}</span>;
}

export function Freshness({ generatedAt, label = "Данные собраны" }: { generatedAt?: string; label?: string }) {
  if (!generatedAt) return null;
  return <div className="text-[10px] text-slate-400">{label}: {formatDateTime(generatedAt)}</div>;
}
