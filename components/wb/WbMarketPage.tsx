"use client";

import { ChartNoAxesCombined, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import { useDashboardFilter } from "@/lib/useDashboardFilter";
import { WB_MARKET_DEFAULT_DAYS, WB_MARKET_DEFAULT_GRAN, wbMarketClosedDateRange } from "@/lib/wb/marketDefaults";
import { WbEmptyState, WbErrorState, WbModuleHeader } from "./WbModuleHeader";
import { useWbCabinet } from "./WbCabinetContext";

interface Niche { id: number; name: string; sku_count: number; cabinets: string[] }
interface Query { word: string; wb_count: number; our_org: number | null; our_ad: number | null }
interface Pulse {
  subject: string;
  cabinet: string;
  gran: "day" | "week";
  date_from: string;
  date_to: string;
  series: Array<{ bucket: string; niche: number; ours: number | null }>;
  niche_growth_pct: number | null;
  our_growth_pct: number | null;
  rel_growth_pct: number | null;
  share_pct: number | null;
  queries: Query[];
  note?: string;
  error?: string;
}

const fmt = (value: number) => Math.round(value).toLocaleString("ru-RU");
const pct = (value: number | null) => value == null ? "—" : `${value > 0 ? "+" : ""}${value}%`;
const shortDate = (iso: string) => { const parts = iso.split("-"); return parts.length === 3 ? `${parts[2]}.${parts[1]}` : iso; };
type MarketPreset = "" | "7" | "30" | "90";

export function WbMarketPage() {
  const { cabinetId, activeCabinet, cabinets, ready, loading: cabinetsLoading, error: cabinetsError } = useWbCabinet();
  const defaultPeriod = useMemo(() => wbMarketClosedDateRange(), []);
  const [niches, setNiches] = useState<Niche[]>([]);
  const [nicheSelection, setNicheSelection] = useDashboardFilter<string>("niche", "");
  const [subject, setSubject] = useDashboardFilter<string>("subject", "", undefined, 300);
  const [granularity, setGranularity] = useDashboardFilter<"day" | "week">("gran", WB_MARKET_DEFAULT_GRAN, ["day", "week"]);
  const [dateFrom, setDateFrom] = useDashboardFilter<string>("from", defaultPeriod.dateFrom);
  const [dateTo, setDateTo] = useDashboardFilter<string>("to", defaultPeriod.dateTo);
  const [preset, setPreset] = useDashboardFilter<MarketPreset>("period", String(WB_MARKET_DEFAULT_DAYS) as MarketPreset, ["", "7", "30", "90"]);
  const [data, setData] = useState<Pulse | null>(null);
  const [nichesLoading, setNichesLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const elapsed = useElapsedSeconds(loading || nichesLoading);

  useEffect(() => {
    if (!ready || cabinetsLoading) return;
    if (!cabinets.length) {
      setNichesLoading(false);
      setError(cabinetsError || "Подключите хотя бы один активный WB-кабинет в настройках");
      return;
    }
    const controller = new AbortController();
    setNichesLoading(true);
    setError(null);
    setData(null);
    fetch(`/api/market/niches?cabinet=${encodeURIComponent(cabinetId || "all")}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const body = (await response.json()) as { niches?: Niche[]; error?: string }; if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`); return body; })
      .then((body) => {
        const next = body.niches ?? [];
        setNiches(next);
        setNicheSelection((current) => current === "__custom" || next.some((item) => current === `id:${item.id}`) ? current : next.length ? `id:${next[0].id}` : "__custom");
      })
      .catch((cause: unknown) => { if (!controller.signal.aborted) { setNiches([]); setNicheSelection("__custom"); setError(cause instanceof Error ? cause.message : "Не удалось определить ниши"); } })
      .finally(() => { if (!controller.signal.aborted) setNichesLoading(false); });
    return () => controller.abort();
  }, [cabinetId, cabinets.length, cabinetsError, cabinetsLoading, ready, setNicheSelection]);

  const loadPulse = useCallback(async () => {
    const byId = nicheSelection.startsWith("id:");
    if (!byId && !subject.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const niche = byId ? `subject_id=${encodeURIComponent(nicheSelection.slice(3))}` : `subject=${encodeURIComponent(subject.trim())}`;
      const period = `&date_from=${dateFrom || defaultPeriod.dateFrom}&date_to=${dateTo || defaultPeriod.dateTo}`;
      const response = await fetch(`/api/market/pulse?${niche}&gran=${granularity}${period}&cabinet=${encodeURIComponent(cabinetId || "all")}`, { cache: "no-store" });
      const body = (await response.json()) as Pulse;
      if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
      setData(body);
    } catch (cause: unknown) {
      setData(null);
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить рынок");
    } finally {
      setLoading(false);
    }
  }, [cabinetId, dateFrom, dateTo, defaultPeriod.dateFrom, defaultPeriod.dateTo, granularity, nicheSelection, subject]);

  useEffect(() => {
    if (nicheSelection.startsWith("id:")) void loadPulse();
  }, [loadPulse, nicheSelection]);

  const applyPreset = (days: number) => {
    const nextPeriod = wbMarketClosedDateRange(days);
    setDateFrom(nextPeriod.dateFrom);
    setDateTo(nextPeriod.dateTo);
    setGranularity(days > WB_MARKET_DEFAULT_DAYS ? "week" : WB_MARKET_DEFAULT_GRAN);
    setPreset(String(days) as MarketPreset);
  };

  return <div className="min-h-[calc(100vh-54px)] bg-[#f6f7f9] pb-16 md:pb-5">
    <WbModuleHeader icon={ChartNoAxesCombined} title="Рынок" description={`Ниша против наших продаж · ${activeCabinet?.name ?? "все кабинеты"}`} actions={<button type="button" onClick={() => void loadPulse()} disabled={loading || (!nicheSelection.startsWith("id:") && !subject.trim())} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 sm:min-h-8"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Обновить</button>} />
    <div className="px-2 py-3 sm:px-6">
      <div className="mb-3 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"><div className="grid gap-2 xl:grid-cols-[minmax(260px,1fr)_auto_auto_auto] xl:items-center"><label className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Ниша<select value={nicheSelection} onChange={(event) => setNicheSelection(event.target.value)} disabled={nichesLoading} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-normal normal-case tracking-normal text-slate-700 outline-none focus:border-violet-400 sm:min-h-9"><option value="">{nichesLoading ? "Определяем ниши…" : "Выберите нишу"}</option>{niches.map((niche) => <option key={niche.id} value={`id:${niche.id}`}>{niche.name} · {niche.sku_count} SKU</option>)}<option value="__custom">Свой путь предмета</option></select></label>{nicheSelection === "__custom" ? <label className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Путь предмета<input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Игрушки/…" className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-xs font-normal normal-case tracking-normal outline-none focus:border-violet-400 sm:min-h-9 xl:w-80" /></label> : null}<div className="flex min-h-11 items-center gap-2 rounded-lg bg-slate-100 p-0.5 sm:min-h-9 sm:gap-0">{(["week", "day"] as const).map((value) => <button type="button" key={value} aria-pressed={granularity === value} onClick={() => setGranularity(value)} className={`min-h-11 rounded-md px-3 text-[10px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:min-h-8 ${granularity === value ? "bg-white text-violet-700 shadow-sm" : "text-slate-500"}`}>{value === "week" ? "Недели" : "Дни"}</button>)}</div><div className="flex min-h-11 items-center gap-2 rounded-lg bg-slate-100 p-0.5 sm:min-h-9 sm:gap-0">{[7, 30, 90].map((days) => <button type="button" key={days} aria-pressed={preset === String(days)} onClick={() => applyPreset(days)} className={`min-h-11 rounded-md px-2.5 text-[10px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:min-h-8 ${preset === String(days) ? "bg-white text-violet-700 shadow-sm" : "text-slate-500"}`}>{days}д</button>)}</div></div><div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center"><label className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">С<input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => { setDateFrom(event.target.value); setPreset(""); }} className="ml-2 min-h-11 rounded-lg border border-slate-200 px-3 text-xs font-normal normal-case tracking-normal outline-none sm:min-h-9" /></label><label className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">По<input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => { setDateTo(event.target.value); setPreset(""); }} className="ml-2 min-h-11 rounded-lg border border-slate-200 px-3 text-xs font-normal normal-case tracking-normal outline-none sm:min-h-9" /></label>{dateFrom || dateTo ? <button type="button" onClick={() => applyPreset(WB_MARKET_DEFAULT_DAYS)} className="min-h-11 rounded-lg px-2 text-[10px] font-semibold text-slate-400 hover:text-violet-700 sm:min-h-9">Сбросить к 30 дням</button> : <span className="text-[10px] text-slate-400">Без дат — последние 30 дней</span>}</div></div>

      {loading || nichesLoading ? <><LoadingBanner seconds={elapsed} hint="Собираем рыночный срез" /><SkeletonTableRows /></> : error ? <WbErrorState message={error} onRetry={() => void loadPulse()} /> : data ? <>
        <div className="mb-3 grid grid-cols-2 gap-2 xl:grid-cols-4"><MetricCard label="Рост ниши" value={pct(data.niche_growth_pct)} trend={data.niche_growth_pct} /><MetricCard label="Наш рост" value={pct(data.our_growth_pct)} trend={data.our_growth_pct} /><MetricCard label="Мы против ниши" value={pct(data.rel_growth_pct)} trend={data.rel_growth_pct} emphasis /><MetricCard label="Доля в нише" value={data.share_pct == null ? "—" : `${data.share_pct}%`} trend={null} /></div>
        <section className="rounded-xl border border-slate-200 bg-white p-3"><div className="mb-2 flex flex-wrap items-center gap-4 text-[10px] text-slate-500"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-sky-500" />Ниша, ₽</span><span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3 bg-violet-600" />Мы, ₽</span><span className="ml-auto">{shortDate(data.date_from)}–{shortDate(data.date_to)}</span></div><div className="min-h-[280px] min-w-0 w-full"><ResponsiveContainer width="100%" height={280} minWidth={0}><LineChart data={data.series} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="bucket" tickFormatter={shortDate} fontSize={10} minTickGap={24} stroke="#94a3b8" /><YAxis yAxisId="market" tickFormatter={(value) => `${Math.round(Number(value) / 1_000_000)}м`} fontSize={10} width={35} stroke="#94a3b8" /><YAxis yAxisId="ours" orientation="right" tickFormatter={(value) => `${Math.round(Number(value) / 1_000)}к`} fontSize={10} width={35} stroke="#94a3b8" /><Tooltip formatter={(value) => `${fmt(Number(value))} ₽`} labelFormatter={(label) => shortDate(String(label))} /><Line yAxisId="market" type="monotone" dataKey="niche" name="Ниша" stroke="#0ea5e9" strokeWidth={2} dot={false} /><Line yAxisId="ours" type="monotone" dataKey="ours" name="Мы" stroke="#7c3aed" strokeWidth={2} dot={{ r: 2 }} /></LineChart></ResponsiveContainer></div></section>
        <section className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="flex items-center border-b border-slate-200 px-3 py-2"><h2 className="text-xs font-bold text-slate-700">Запросы ниши и наши позиции</h2><span className="ml-auto text-[10px] text-slate-400">{data.queries.length} запросов</span></div>{data.queries.length ? <div className="overflow-auto"><table className="min-w-full text-[10px]"><thead className="bg-slate-50 text-slate-500"><tr className="h-9"><th className="px-3 text-left">Запрос</th><th className="px-3 text-right">Спрос WB</th><th className="px-3 text-right">Органика</th><th className="px-3 text-right">Реклама</th><th className="px-3 text-left">Статус</th></tr></thead><tbody>{data.queries.map((query) => { const state = query.our_org == null && query.our_ad == null ? "absent" : query.our_org != null && query.our_org > 100 ? "deep" : "top"; return <tr key={query.word} className="h-10 border-t border-slate-100 hover:bg-violet-50/20"><td className="min-w-[260px] px-3 font-medium text-slate-700">{query.word}</td><td className="px-3 text-right tabular-nums text-slate-500">{fmt(query.wb_count)}</td><td className="px-3 text-right font-semibold tabular-nums text-slate-700">{query.our_org ?? "—"}</td><td className="px-3 text-right tabular-nums text-slate-500">{query.our_ad ?? "—"}</td><td className="px-3"><span className={`rounded-md px-2 py-1 text-[9px] font-semibold ${state === "top" ? "bg-emerald-50 text-emerald-700" : state === "deep" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"}`}>{state === "top" ? "В топе" : state === "deep" ? "Глубоко" : "Нас нет"}</span></td></tr>; })}</tbody></table></div> : <div className="p-3"><WbEmptyState>Нет поисковых запросов за период.</WbEmptyState></div>}</section>
        {data.note ? <p className="mt-2 text-[10px] text-slate-400">{data.note}</p> : null}
      </> : <WbEmptyState>Выберите нишу, чтобы построить сравнение.</WbEmptyState>}
    </div>
  </div>;
}

function MetricCard({ label, value, trend, emphasis }: { label: string; value: string; trend: number | null; emphasis?: boolean }) {
  const positive = trend != null && trend >= 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  return <div className={`rounded-xl border bg-white p-3 ${emphasis ? "border-violet-300 ring-1 ring-violet-100" : "border-slate-200"}`}><div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500">{label}{trend != null ? <Icon className={`h-3.5 w-3.5 ${positive ? "text-emerald-600" : "text-rose-600"}`} /> : null}</div><div className={`mt-1 text-[22px] font-bold tabular-nums ${trend == null ? "text-slate-800" : positive ? "text-emerald-700" : "text-rose-600"}`}>{value}</div></div>;
}
