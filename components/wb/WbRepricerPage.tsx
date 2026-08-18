"use client";

import { Download, Loader2, Play, Search, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import { WbEmptyState, WbErrorState } from "./WbModuleHeader";
import { useWbCabinet } from "./WbCabinetContext";

interface Strategy {
  id: number;
  name: string;
  action: "inc_pct" | "dec_pct";
  amount: number;
  marginFloor: number;
  enabled: boolean;
}

interface UsedCondition {
  metric: string;
  op: string;
  value: number;
  actual: number | null;
  match: boolean;
}

interface DecisionMetrics {
  gmroi: number | null;
  margin: number | null;
  drr: number | null;
  stock: number;
  turnover: number | null;
}

interface Decision {
  nm_id: number;
  article: string | null;
  strategy_name: string | null;
  old_price: number | null;
  new_price: number | null;
  metrics: DecisionMetrics | null;
  used?: UsedCondition[] | null;
  status: "proposed" | "skipped" | string;
  note: string | null;
}

interface SignalItem { nm: number; signal: string }
type DecisionFilter = "all" | "proposed" | "skipped";

const STRATEGY_TONE: Record<string, string> = {
  "Разгон GMROI": "bg-emerald-500",
  "Рост маржи": "bg-violet-500",
  "Скоро аут": "bg-amber-500",
  "ДРР позволяет": "bg-cyan-600",
};

const SIGNAL_TONE: Record<string, string> = {
  "Контент": "bg-violet-500",
  "Конкуренты": "bg-rose-500",
  "Реклама": "bg-cyan-600",
  "Остатки": "bg-amber-500",
  "ДРР": "bg-orange-500",
  "Маржа": "bg-emerald-500",
};

const rub = (value: number | null | undefined) => value == null ? "—" : `${Math.round(value).toLocaleString("ru-RU")} ₽`;
const pct = (value: number | null | undefined) => value == null ? "—" : `${Math.round(value * 10) / 10}%`;
const today = () => new Date().toISOString().slice(0, 10);

async function responseBody<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
  return body;
}

function explanation(decision: Decision) {
  if (decision.note) return decision.note;
  const used = decision.used ?? [];
  if (!used.length) return "нет подходящей стратегии";
  return used.map((condition) => `${condition.metric} ${condition.op} ${condition.value} · факт ${condition.actual ?? "—"}`).join("; ");
}

export function WbRepricerPage() {
  const { cabinetId, activeCabinet, cabinets, ready, loading: cabinetsLoading, error: cabinetsError, canWrite } = useWbCabinet();
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [signals, setSignals] = useState<Map<number, string>>(new Map());
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DecisionFilter>("all");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const requestId = useRef(0);
  const [date] = useState(today);
  const elapsed = useElapsedSeconds(loading);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!ready || cabinetsLoading) return;
    if (!cabinets.length) {
      setLoading(false);
      setError(cabinetsError || "Подключите хотя бы один активный WB-кабинет в настройках");
      return;
    }

    const current = ++requestId.current;
    setLoading(true);
    setError(null);
    const cabinet = encodeURIComponent(cabinetId || "all");

    try {
      const [stateResponse, decisionsResponse, signalsResponse] = await Promise.all([
        fetch("/api/repricer/state", { cache: "no-store", signal }),
        fetch(`/api/repricer/decisions?date=${date}&cabinet=${cabinet}`, { cache: "no-store", signal }),
        cabinetId === "all" ? Promise.resolve(null) : fetch(`/api/signals?cabinet=${cabinet}&window=14&persist=0`, { cache: "no-store", signal }),
      ]);
      const [stateBody, decisionsBody, signalsBody] = await Promise.all([
        responseBody<{ strategies?: Strategy[] }>(stateResponse),
        responseBody<{ decisions?: Decision[] }>(decisionsResponse),
        signalsResponse ? responseBody<{ items?: SignalItem[] }>(signalsResponse) : Promise.resolve({ items: [] }),
      ]);
      if (current !== requestId.current) return;
      setStrategies(stateBody.strategies ?? []);
      setDecisions(decisionsBody.decisions ?? []);
      setSignals(new Map((signalsBody.items ?? []).map((item) => [item.nm, item.signal])));
    } catch (cause: unknown) {
      if (current === requestId.current && !signal?.aborted) {
        setError(cause instanceof Error ? cause.message : "Не удалось загрузить решения репрайсера");
      }
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [cabinetId, cabinets.length, cabinetsError, cabinetsLoading, date, ready]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, retryKey]);

  const run = async () => {
    if (!canWrite || running) return;
    const confirmed = window.confirm(`Сформировать новые предложения цены для кабинета «${activeCabinet?.name ?? "WB"}»? Цены на WB автоматически не изменятся.`);
    if (!confirmed) return;
    setRunning(true);
    setError(null);
    try {
      const response = await fetch(`/api/repricer/run?cabinet=${encodeURIComponent(cabinetId)}`, { method: "POST" });
      await responseBody<Record<string, unknown>>(response);
      await load();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Не удалось выполнить прогон");
    } finally {
      setRunning(false);
    }
  };

  const proposedCount = decisions.filter((decision) => decision.status === "proposed").length;
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    return decisions.filter((decision) => {
      if (filter !== "all" && decision.status !== filter) return false;
      if (!needle) return true;
      return `${decision.nm_id} ${decision.article ?? ""} ${decision.strategy_name ?? ""}`.toLocaleLowerCase("ru-RU").includes(needle);
    });
  }, [decisions, filter, query]);

  const exportHref = canWrite && proposedCount > 0
    ? `/api/repricer/export?date=${date}&cabinet=${encodeURIComponent(cabinetId)}`
    : null;

  return (
    <div className="px-2 py-3 sm:px-6">
      <div className="mb-2 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)] xl:flex-row xl:items-center">
        <div className="flex min-w-0 gap-1 overflow-x-auto pb-1 xl:pb-0" role="tablist" aria-label="Фильтр решений">
          {([[
            "all", `Все ${decisions.length}`,
          ], ["proposed", `Предложения ${proposedCount}`], ["skipped", `Без изменений ${decisions.length - proposedCount}`]] as Array<[DecisionFilter, string]>).map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)} className={`min-h-11 shrink-0 rounded-lg px-3 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:min-h-8 ${filter === value ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"}`}>{label}</button>
          ))}
        </div>

        <label className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 focus-within:border-violet-400 xl:w-64 xl:min-h-8">
          <Search className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          <span className="sr-only">Поиск по решениям</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="nm, артикул, стратегия" className="min-w-0 flex-1 bg-transparent text-xs outline-none" />
          {query ? <button type="button" aria-label="Очистить поиск" onClick={() => setQuery("")} className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-white"><X className="h-3.5 w-3.5" /></button> : null}
        </label>

        <div className="flex flex-wrap items-center gap-2 xl:ml-auto">
          <button type="button" onClick={run} disabled={!canWrite || running} title={canWrite ? "Сформировать предложения" : "Выберите один кабинет"} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-violet-600 px-3 text-[11px] font-semibold text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:min-h-9">
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Play className="h-3.5 w-3.5" aria-hidden="true" />}
            {running ? "Считаем…" : "Прогнать сейчас"}
          </button>
          {exportHref ? (
            <a href={exportHref} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:min-h-9"><Download className="h-3.5 w-3.5" aria-hidden="true" />Скачать XLSX</a>
          ) : (
            <button type="button" disabled title={canWrite ? "Нет предложений для экспорта" : "Выберите один кабинет"} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-400 opacity-60 sm:min-h-9"><Download className="h-3.5 w-3.5" aria-hidden="true" />Скачать XLSX</button>
          )}
        </div>
      </div>

      <div className="mb-2 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[10px] text-slate-500 lg:flex-row lg:items-center">
        <div className="flex items-center gap-2 font-semibold text-emerald-700"><ShieldCheck className="h-4 w-4" aria-hidden="true" />Только предложения: применение цен вручную через XLSX</div>
        {!canWrite ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">Режим «Все кабинеты» доступен только для просмотра</div> : null}
        <div className="lg:ml-auto">Прогон {date} · {activeCabinet?.name ?? "все кабинеты"}</div>
      </div>

      {strategies.length > 0 ? (
        <div className="mb-2 flex gap-x-4 gap-y-2 overflow-x-auto rounded-xl border border-slate-200 bg-white px-3 py-2.5">
          {strategies.map((strategy) => (
            <span key={strategy.id} className={`inline-flex shrink-0 items-center gap-2 text-[10px] ${strategy.enabled ? "text-slate-600" : "text-slate-300"}`}>
              <span className={`h-2 w-2 rounded-full ${STRATEGY_TONE[strategy.name] ?? "bg-slate-400"}`} aria-hidden="true" />
              <span className="font-semibold">{strategy.name}</span>
              <span>{strategy.action === "dec_pct" ? "−" : "+"}{strategy.amount}% · пол {strategy.marginFloor}%</span>
            </span>
          ))}
        </div>
      ) : null}

      {loading ? <><LoadingBanner seconds={elapsed} hint="Загружаем стратегии, решения и сигналы" /><div className="rounded-xl border border-slate-200 bg-white"><SkeletonTableRows rows={12} cols={10} /></div></> : error ? <WbErrorState message={error} onRetry={() => setRetryKey((value) => value + 1)} /> : strategies.length === 0 ? <WbEmptyState>Стратегии репрайсера не настроены. Проверьте миграцию и сид-стратегии.</WbEmptyState> : filtered.length === 0 ? <WbEmptyState>{decisions.length ? "Нет решений по текущему фильтру." : "За сегодня прогонов нет. Выберите один кабинет и нажмите «Прогнать сейчас»."}</WbEmptyState> : (
        <div className="h-[calc(100vh-292px)] min-h-[430px] overflow-auto rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <table className="min-w-max w-full border-separate border-spacing-0 text-[10px]">
            <thead className="sticky top-0 z-20 bg-slate-50 text-slate-500"><tr className="h-10">
              <th className="sticky left-0 z-30 min-w-[190px] border-b border-r border-slate-200 bg-slate-50 px-3 text-left font-semibold">SKU</th>
              <th className="min-w-[150px] border-b border-slate-200 px-3 text-left">Стратегия</th>
              <th className="min-w-[82px] border-b border-slate-200 px-2 text-right">Цена</th>
              <th className="min-w-[82px] border-b border-slate-200 px-2 text-right">Новая</th>
              <th className="min-w-[72px] border-b border-r border-slate-200 px-2 text-right">Δ</th>
              <th className="min-w-[66px] border-b border-slate-200 px-2 text-right">Маржа</th>
              <th className="min-w-[66px] border-b border-slate-200 px-2 text-right">GMROI</th>
              <th className="min-w-[60px] border-b border-slate-200 px-2 text-right">ДРР</th>
              <th className="min-w-[64px] border-b border-slate-200 px-2 text-right">Остаток</th>
              <th className="min-w-[100px] border-b border-slate-200 px-3 text-left">Сигнал</th>
              <th className="min-w-[240px] border-b border-slate-200 px-3 text-left">Почему</th>
            </tr></thead>
            <tbody>{filtered.map((decision) => {
              const delta = decision.old_price != null && decision.new_price != null ? decision.new_price - decision.old_price : null;
              const signal = signals.get(decision.nm_id);
              const metrics = decision.metrics;
              return (
                <tr key={`${decision.nm_id}-${decision.strategy_name ?? "none"}`} className="h-12 hover:bg-violet-50/20">
                  <td className="sticky left-0 z-10 border-b border-r border-slate-100 bg-white px-3"><div className="font-semibold text-violet-700">{decision.article ?? decision.nm_id}</div><div className="text-[9px] text-slate-400">nm {decision.nm_id}</div></td>
                  <td className="border-b border-slate-100 px-3">{decision.strategy_name ? <span className="inline-flex items-center gap-2 font-semibold text-slate-600"><span className={`h-2 w-2 rounded-full ${STRATEGY_TONE[decision.strategy_name] ?? "bg-slate-400"}`} aria-hidden="true" />{decision.strategy_name}</span> : <span className="text-slate-300">—</span>}</td>
                  <td className="border-b border-slate-100 px-2 text-right tabular-nums text-slate-500">{rub(decision.old_price)}</td>
                  <td className="border-b border-slate-100 px-2 text-right font-semibold tabular-nums text-slate-800">{rub(decision.new_price)}</td>
                  <td className={`border-b border-r border-slate-100 px-2 text-right font-semibold tabular-nums ${delta == null || delta === 0 ? "text-slate-300" : delta > 0 ? "text-emerald-600" : "text-rose-600"}`}>{delta == null ? "—" : delta > 0 ? `+${rub(delta)}` : rub(delta)}</td>
                  <td className={`border-b border-slate-100 px-2 text-right tabular-nums ${metrics?.margin != null && metrics.margin < 15 ? "text-rose-600" : "text-slate-600"}`}>{pct(metrics?.margin)}</td>
                  <td className="border-b border-slate-100 px-2 text-right tabular-nums text-slate-600">{pct(metrics?.gmroi)}</td>
                  <td className="border-b border-slate-100 px-2 text-right tabular-nums text-slate-600">{pct(metrics?.drr)}</td>
                  <td className="border-b border-slate-100 px-2 text-right tabular-nums text-slate-600">{metrics?.stock?.toLocaleString("ru-RU") ?? "—"}</td>
                  <td className="border-b border-slate-100 px-3">{signal ? <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 font-semibold text-slate-600"><span className={`h-2 w-2 rounded-full ${SIGNAL_TONE[signal] ?? "bg-slate-400"}`} aria-hidden="true" />{signal}</span> : <span className="text-slate-300">—</span>}</td>
                  <td className="max-w-[320px] border-b border-slate-100 px-3 text-slate-500"><span className="line-clamp-2" title={explanation(decision)}>{explanation(decision)}</span></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
