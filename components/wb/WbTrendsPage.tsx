"use client";

import { ArrowDown, ArrowUp, TrendingUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LoadingBanner, SkeletonCards, useElapsedSeconds } from "@/components/ui/LoadingState";
import { useDashboardFilter } from "@/lib/useDashboardFilter";
import { WbErrorState, WbModuleHeader } from "./WbModuleHeader";
import { useWbCabinet } from "./WbCabinetContext";

interface Metric { key: string; label: string; kind: "money" | "int" | "pct"; goodUp: boolean; current: number; previous: number; deltaPct: number; series: number[] }
interface TrendsData { window: number; current: { from: string; to: string }; previous: { from: string; to: string }; metrics: Metric[]; error?: string }

const fmt = (value: number, kind: Metric["kind"]) => kind === "pct" ? `${Math.round(value * 10) / 10}%` : Math.round(value).toLocaleString("ru-RU");
const shortDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

function Sparkline({ values, positive, label }: { values: number[]; positive: boolean; label: string }) {
  if (!values.length) return <div className="h-12" />;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const width = 240;
  const height = 48;
  const points = values.map((value, index) => `${values.length === 1 ? width / 2 : index / (values.length - 1) * width},${height - (value - min) / range * (height - 4) - 2}`).join(" ");
  const color = positive ? "#059669" : "#e11d48";
  return <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Динамика: ${label}`} className="h-12 w-full" preserveAspectRatio="none"><polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /></svg>;
}

export function WbTrendsPage() {
  const { cabinetId, activeCabinet, cabinets, ready, loading: cabinetsLoading, error: cabinetsError } = useWbCabinet();
  const [windowParam, setWindowParam] = useDashboardFilter("days", "7", ["7", "14", "30"] as const);
  const windowDays = Number(windowParam);
  const setWindowDays = (days: number) => setWindowParam(String(days) as typeof windowParam);
  const [data, setData] = useState<TrendsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const requestId = useRef(0);
  const elapsed = useElapsedSeconds(loading);

  useEffect(() => {
    if (!ready || cabinetsLoading) return;
    if (!cabinets.length) {
      setLoading(false);
      setError(cabinetsError || "Подключите хотя бы один активный WB-кабинет в настройках");
      return;
    }
    const controller = new AbortController();
    const current = ++requestId.current;
    setLoading(true);
    setError(null);
    fetch(`/api/trends?window=${windowDays}&cabinet=${encodeURIComponent(cabinetId || "all")}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const body = (await response.json()) as TrendsData; if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`); return body; })
      .then((body) => { if (current === requestId.current) setData(body); })
      .catch((cause: unknown) => { if (current === requestId.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить динамику"); })
      .finally(() => { if (current === requestId.current) setLoading(false); });
    return () => controller.abort();
  }, [cabinetId, cabinets.length, cabinetsError, cabinetsLoading, ready, retryKey, windowDays]);

  const period = data ? `${shortDate(data.current.from)}–${shortDate(data.current.to)} против ${shortDate(data.previous.from)}–${shortDate(data.previous.to)}` : "Период к периоду";

  return <div className="min-h-[calc(100vh-54px)] bg-[#f6f7f9] pb-16 md:pb-5">
    <WbModuleHeader icon={TrendingUp} title="Динамика" description={`${period} · ${activeCabinet?.name ?? "все кабинеты"}`} actions={<div className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white p-0.5 sm:min-h-8 sm:gap-0">{[7, 14, 30].map((days) => <button key={days} type="button" onClick={() => setWindowDays(days)} className={`min-h-11 rounded-md px-3 text-[10px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:min-h-7 ${windowDays === days ? "bg-violet-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>{days}д vs {days}д</button>)}</div>} />
    <div className="px-2 py-3 sm:px-6">
      {loading ? <><LoadingBanner seconds={elapsed} hint="Сравниваем два периода" /><SkeletonCards count={6} /></> : error ? <WbErrorState message={error} onRetry={() => setRetryKey((value) => value + 1)} /> : data ? <>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{data.metrics.map((metric) => { const positive = metric.deltaPct === 0 || (metric.goodUp ? metric.deltaPct > 0 : metric.deltaPct < 0); const DeltaIcon = metric.deltaPct >= 0 ? ArrowUp : ArrowDown; return <article key={metric.key} className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"><div className="flex items-center justify-between gap-2"><h2 className="truncate text-[10px] font-semibold text-slate-500">{metric.label}</h2><span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[9px] font-bold ${positive ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}><DeltaIcon className="h-3 w-3" />{Math.abs(metric.deltaPct)}%</span></div><div className="mt-2 text-[22px] font-bold tracking-tight tabular-nums text-slate-800">{fmt(metric.current, metric.kind)}</div><div className="mt-0.5 text-[9px] text-slate-400">было {fmt(metric.previous, metric.kind)}</div><div className="mt-2 border-t border-slate-100 pt-2"><Sparkline values={metric.series} positive={positive} label={metric.label} /></div></article>; })}</div>
        <div className="mt-3 overflow-auto rounded-xl border border-slate-200 bg-white"><table className="min-w-full text-[11px]"><thead className="bg-slate-50 text-slate-500"><tr className="h-9 border-b border-slate-200"><th className="px-3 text-left">Показатель</th><th className="px-3 text-right">Текущий период</th><th className="px-3 text-right">Прошлый период</th><th className="px-3 text-right">Изменение</th><th className="min-w-[260px] px-3 text-left">Тренд по дням</th></tr></thead><tbody>{data.metrics.map((metric) => { const positive = metric.deltaPct === 0 || (metric.goodUp ? metric.deltaPct > 0 : metric.deltaPct < 0); return <tr key={metric.key} className="h-14 border-b border-slate-100 last:border-0"><td className="px-3 font-semibold text-slate-700">{metric.label}</td><td className="px-3 text-right font-semibold tabular-nums text-slate-800">{fmt(metric.current, metric.kind)}</td><td className="px-3 text-right tabular-nums text-slate-500">{fmt(metric.previous, metric.kind)}</td><td className={`px-3 text-right font-bold tabular-nums ${positive ? "text-emerald-700" : "text-rose-600"}`}>{metric.deltaPct > 0 ? "+" : ""}{metric.deltaPct}%</td><td className="px-3"><Sparkline values={metric.series} positive={positive} label={metric.label} /></td></tr>; })}</tbody></table></div>
      </> : null}
    </div>
  </div>;
}
