"use client";

import { ChevronRight, Loader2, Megaphone, RefreshCw, Search, WalletCards } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LoadingBanner, SkeletonCards, useElapsedSeconds } from "@/components/ui/LoadingState";
import { WbEmptyState, WbErrorState, WbModuleHeader } from "./WbModuleHeader";
import { useWbCabinet } from "./WbCabinetContext";

interface DayPoint {
  ts: string;
  spend: number;
  clicks: number;
  views: number;
  orders: number;
}

interface AdvertEconomics {
  breakEvenDrr: number | null;
  breakEvenRoas: number | null;
  profitAfterAds: number | null;
  currentDrr: number | null;
  currentRoas: number | null;
  daysCover: number | null;
  stockRisk: "out" | "critical" | "warning" | "ok" | "unknown";
  action: "increase" | "hold" | "decrease" | "pause" | "insufficient";
  budgetChangePct: number | null;
  expectedProfitEffect: number | null;
  reason: string;
  confidence: "high" | "medium" | "low" | "unavailable";
  confidencePct: number;
}

interface BeforeAfter {
  changedAt: string;
  before: { days: number; spent: number; revenue: number; drr: number | null };
  after: { days: number; spent: number; revenue: number; drr: number | null };
  drrDelta: number | null;
}

interface Campaign {
  id: number;
  name: string;
  enabled: boolean;
  budget: number;
  spend_today: number;
  spent_14: number;
  ad_revenue_14: number;
  drr: number | null;
  bid_type?: string;
  payment?: string;
  days: DayPoint[];
  economics: AdvertEconomics;
  attribution_compatible: boolean;
  last_change: { old_bid: number | null; new_bid: number | null; created_at: string } | null;
  comparison: BeforeAfter | null;
}

interface Article {
  nm: number;
  art: string;
  photo: string;
  spend: number;
  campaigns: Campaign[];
}

interface AdvertsData {
  ok: boolean;
  error?: string;
  cabinet?: string;
  articles: Article[];
  count: number;
  cap_rub: number;
  balance: number | null;
  spend_today_total: number;
  spend_yest_total: number;
}

interface CampaignRow {
  article: Article;
  campaign: Campaign;
}

const ROW_HEIGHT = 64;
const rub = (value: number | null) => value == null ? "—" : `${Math.round(value).toLocaleString("ru-RU")} ₽`;
const pct = (value: number | null) => value == null ? "—" : `${Math.round(value * 10) / 10}%`;

function drrTone(value: number | null) {
  if (value == null) return "bg-slate-100 text-slate-400";
  if (value <= 10) return "bg-emerald-50 text-emerald-700";
  if (value <= 20) return "bg-amber-50 text-amber-700";
  return "bg-rose-50 text-rose-700";
}

function actionLabel(economics: AdvertEconomics) {
  if (economics.action === "increase") return `Увеличить ${economics.budgetChangePct}%`;
  if (economics.action === "decrease") return `Снизить ${Math.abs(economics.budgetChangePct ?? 0)}%`;
  if (economics.action === "pause") return "Поставить на паузу";
  if (economics.action === "insufficient") return "Недостаточно данных";
  return "Оставить без изменений";
}

function actionTone(action: AdvertEconomics["action"]) {
  if (action === "increase") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (action === "decrease" || action === "pause") return "border-rose-200 bg-rose-50 text-rose-800";
  if (action === "insufficient") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="h-28 rounded-lg bg-slate-50" />;
  const width = 520;
  const height = 104;
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => `${(index / (values.length - 1)) * width},${height - (value / max) * (height - 14) - 7}`).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-28 w-full overflow-visible rounded-lg bg-slate-50 p-2" aria-label="Динамика расхода">
      <polyline points={points} fill="none" stroke="#7c3aed" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function WbAdvertsPage() {
  const { activeCabinet, cabinetId, cabinets, ready, loading: cabinetsLoading, error: cabinetsError } = useWbCabinet();
  const [data, setData] = useState<AdvertsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "cpc" | "unified">("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [rowWindow, setRowWindow] = useState({ start: 0, end: 16 });
  const requestId = useRef(0);
  const elapsed = useElapsedSeconds(loading);

  useEffect(() => {
    if (!ready || cabinetsLoading) return;
    if (cabinets.length === 0) {
      setLoading(false);
      setError(cabinetsError || "Подключите хотя бы один активный WB-кабинет в настройках");
      return;
    }
    const controller = new AbortController();
    const current = ++requestId.current;
    let timedOut = false;
    const deadline = window.setTimeout(() => { timedOut = true; controller.abort(); }, 45_000);
    setLoading(true);
    setError(null);
    fetch(`/api/adverts/list?cabinet=${encodeURIComponent(cabinetId || "all")}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as AdvertsData;
        if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
        return body;
      })
      .then((body) => {
        if (current !== requestId.current) return;
        if (!body.ok) throw new Error(body.error || "Не удалось загрузить рекламу");
        setData(body);
      })
      .catch((cause: unknown) => {
        if (current !== requestId.current || (controller.signal.aborted && !timedOut)) return;
        setError(timedOut ? "Рекламный кабинет не ответил за 45 секунд. Повторите запрос." : cause instanceof Error ? cause.message : "Не удалось загрузить рекламу");
      })
      .finally(() => {
        window.clearTimeout(deadline);
        if (current === requestId.current) setLoading(false);
      });
    return () => { window.clearTimeout(deadline); controller.abort(); };
  }, [cabinetId, cabinets.length, cabinetsError, cabinetsLoading, ready, retryKey]);

  const rows = useMemo<CampaignRow[]>(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    return (data?.articles ?? []).flatMap((article) => article.campaigns.map((campaign) => ({ article, campaign }))).filter(({ article, campaign }) => {
      const campaignKind = campaign.payment === "cpc" ? "cpc" : "unified";
      if (kind !== "all" && campaignKind !== kind) return false;
      return !needle || `${article.art} ${article.nm} ${campaign.name} ${campaign.id}`.toLocaleLowerCase("ru-RU").includes(needle);
    });
  }, [data?.articles, kind, query]);

  useEffect(() => {
    if (!rows.some(({ campaign }) => campaign.id === selectedId)) setSelectedId(rows[0]?.campaign.id ?? null);
    setRowWindow({ start: 0, end: Math.min(16, rows.length) });
  }, [rows, selectedId]);

  const selected = rows.find(({ campaign }) => campaign.id === selectedId) ?? null;
  const updateWindow = (element: HTMLDivElement) => {
    const first = Math.floor(element.scrollTop / ROW_HEIGHT);
    const visible = Math.ceil(element.clientHeight / ROW_HEIGHT);
    const start = Math.max(0, first - 5);
    const end = Math.min(rows.length, first + visible + 6);
    setRowWindow((current) => current.start === start && current.end === end ? current : { start, end });
  };

  return (
    <div className="min-h-[calc(100vh-54px)] bg-[#f6f7f9] pb-16 md:pb-5">
      <WbModuleHeader
        icon={Megaphone}
        title="Реклама"
        description={data ? `${data.count} активных кампаний · расход сегодня ${rub(data.spend_today_total)}` : "Кампании, ставки, расписание и статистика"}
        actions={
          <button type="button" onClick={() => setRetryKey((value) => value + 1)} disabled={loading} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60 sm:min-h-8">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="h-3.5 w-3.5" />} Обновить
          </button>
        }
      />

      <div className="grid min-h-[calc(100vh-110px)] gap-3 px-2 py-3 sm:px-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <section className="flex min-h-[480px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="border-b border-slate-200 p-3">
            <label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100 sm:min-h-8">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="артикул, название или #id" className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-slate-400" />
            </label>
            <div className="mt-2 flex items-center gap-1 text-[10px]">
              <span className="mr-1 text-slate-400">тип:</span>
              {([['all', 'Все'], ['cpc', 'CPC'], ['unified', 'Единая']] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setKind(value)} className={`min-h-8 rounded-lg px-2.5 font-semibold transition-colors ${kind === value ? "bg-slate-800 text-white" : "bg-violet-50 text-violet-700 hover:bg-violet-100"}`}>{label}</button>
              ))}
              <span className="ml-auto tabular-nums text-slate-400">{rows.length} РК</span>
            </div>
          </div>

          {loading ? <div className="p-3"><LoadingBanner seconds={elapsed} hint={`реклама · ${activeCabinet?.name ?? "все кабинеты"}`} /><SkeletonCards count={5} /></div> : error ? <div className="p-3"><WbErrorState message={error} onRetry={() => setRetryKey((value) => value + 1)} /></div> : rows.length === 0 ? <div className="p-3"><WbEmptyState>Кампаний по выбранному фильтру нет.</WbEmptyState></div> : (
            <div className="min-h-0 flex-1 overflow-auto overscroll-contain" onScroll={(event) => updateWindow(event.currentTarget)}>
              {rowWindow.start > 0 ? <div aria-hidden="true" style={{ height: rowWindow.start * ROW_HEIGHT }} /> : null}
              {rows.slice(rowWindow.start, rowWindow.end).map(({ article, campaign }) => {
                const active = selectedId === campaign.id;
                return (
                  <button type="button" key={campaign.id} onClick={() => setSelectedId(campaign.id)} className={`flex h-[64px] w-full items-center gap-2 border-b border-slate-100 px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 ${active ? "bg-violet-50" : "hover:bg-slate-50"}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={article.photo} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-lg border border-slate-100 bg-slate-50 object-cover" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${campaign.enabled ? "bg-emerald-400" : "bg-amber-400"}`} /><span className="truncate text-[11px] font-medium text-slate-700">{campaign.name}</span></div>
                      <div className="mt-1 flex items-center gap-1.5 text-[9px] text-slate-400"><span className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-700">CPM</span><span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">единая</span><span className="truncate">{article.art}</span></div>
                    </div>
                    <div className="shrink-0 text-right"><div className="text-[10px] font-semibold tabular-nums text-slate-700">{rub(campaign.spend_today)}</div><div className={`mt-1 rounded px-1.5 py-0.5 text-[9px] font-semibold tabular-nums ${drrTone(campaign.drr)}`}>ДРР {pct(campaign.drr)}</div></div>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                  </button>
                );
              })}
              {rowWindow.end < rows.length ? <div aria-hidden="true" style={{ height: (rows.length - rowWindow.end) * ROW_HEIGHT }} /> : null}
            </div>
          )}
        </section>

        <section className="min-w-0 rounded-xl border border-dashed border-slate-200 bg-white">
          {!selected ? (
            <div className="grid min-h-[420px] place-items-center px-6 text-center text-sm leading-5 text-slate-400">Выберите кампанию слева — здесь откроется её карточка: расписание, статистика и разбор.</div>
          ) : (
            <div className="p-3 sm:p-5">
              <div className="flex items-start gap-3 border-b border-slate-100 pb-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={selected.article.photo} alt="" className="h-14 w-14 rounded-xl border border-slate-100 bg-slate-50 object-cover" />
                <div className="min-w-0"><div className="text-sm font-bold text-slate-800">{selected.campaign.name}</div><div className="mt-1 text-[11px] text-slate-400">{selected.article.art} · nm {selected.article.nm} · РК #{selected.campaign.id}</div></div>
                <span className={`ml-auto rounded-full px-2 py-1 text-[10px] font-semibold ${selected.campaign.enabled ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{selected.campaign.enabled ? "Активна" : "Пауза"}</span>
              </div>

              <div className="grid grid-cols-2 gap-2 py-4 sm:grid-cols-4">
                {[
                  ["Расход 14 дней", rub(selected.campaign.spent_14)],
                  ["Выручка с рекламы", rub(selected.campaign.ad_revenue_14)],
                  ["ДРР / break-even", `${pct(selected.campaign.economics.currentDrr)} / ${pct(selected.campaign.economics.breakEvenDrr)}`],
                  ["Прибыль после рекламы", rub(selected.campaign.economics.profitAfterAds)],
                  ["ROAS / break-even", `${selected.campaign.economics.currentRoas ?? "—"}× / ${selected.campaign.economics.breakEvenRoas ?? "—"}×`],
                  ["Запас", selected.campaign.economics.daysCover == null ? "—" : `${selected.campaign.economics.daysCover} дн.`],
                  ["Дневной бюджет", rub(selected.campaign.budget)],
                  ["Уверенность", `${selected.campaign.economics.confidencePct}%`],
                ].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3"><div className="text-[9px] uppercase tracking-wide text-slate-400">{label}</div><div className="mt-1 text-sm font-semibold tabular-nums text-slate-700">{value}</div></div>)}
              </div>

              <section className={`mb-3 rounded-xl border p-3 ${actionTone(selected.campaign.economics.action)}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><div className="text-[9px] font-semibold uppercase tracking-wide opacity-70">Рекомендация</div><div className="mt-1 text-sm font-bold">{actionLabel(selected.campaign.economics)}</div></div>
                  <div className="text-right"><div className="text-[9px] opacity-70">Ожидаемый эффект за 14 дней</div><div className="mt-1 text-sm font-bold tabular-nums">{rub(selected.campaign.economics.expectedProfitEffect)}</div></div>
                </div>
                <p className="mt-2 text-[11px] leading-5">{selected.campaign.economics.reason}</p>
                {!selected.campaign.attribution_compatible && <p className="mt-1 text-[10px] font-semibold">Модели атрибуции или состав кампании не совпадают — рекомендация понижена по уверенности.</p>}
              </section>

              <div className="rounded-xl border border-slate-200 p-3"><div className="mb-2 flex items-center justify-between"><h2 className="text-xs font-bold text-slate-700">Расход по дням</h2><span className="text-[10px] text-slate-400">последние 14 дней</span></div><Sparkline values={selected.campaign.days.map((day) => day.spend)} /></div>

              <section className="mt-3 rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2"><h2 className="text-xs font-bold text-slate-700">До / после изменения ставки</h2>{selected.campaign.last_change && <span className="text-[9px] text-slate-400">{new Date(selected.campaign.last_change.created_at).toLocaleDateString("ru-RU")}</span>}</div>
                {selected.campaign.comparison ? <div className="mt-3 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-slate-50 p-2"><div className="text-[9px] text-slate-400">До</div><div className="mt-1 font-semibold">ДРР {pct(selected.campaign.comparison.before.drr)}</div><div className="text-[9px] text-slate-400">{selected.campaign.comparison.before.days} дн.</div></div><div className="rounded-lg bg-violet-50 p-2"><div className="text-[9px] text-violet-500">Изменение</div><div className="mt-1 font-semibold text-violet-700">{selected.campaign.last_change?.old_bid ?? "—"} → {selected.campaign.last_change?.new_bid ?? "—"}</div><div className="text-[9px] text-violet-500">ставка</div></div><div className="rounded-lg bg-slate-50 p-2"><div className="text-[9px] text-slate-400">После</div><div className="mt-1 font-semibold">ДРР {pct(selected.campaign.comparison.after.drr)}</div><div className={`text-[9px] ${Number(selected.campaign.comparison.drrDelta) <= 0 ? "text-emerald-600" : "text-rose-600"}`}>{selected.campaign.comparison.drrDelta == null ? "—" : `${selected.campaign.comparison.drrDelta > 0 ? "+" : ""}${selected.campaign.comparison.drrDelta} п.п.`}</div></div></div> : <p className="mt-2 text-[10px] leading-4 text-slate-400">Нужны минимум два дня статистики до и после последнего зафиксированного изменения ставки.</p>}
              </section>

              <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full border-collapse text-[10px]">
                  <thead><tr className="h-8 bg-slate-50 text-slate-500"><th className="px-3 text-left">Дата</th><th className="px-3 text-right">Показы</th><th className="px-3 text-right">Клики</th><th className="px-3 text-right">Расход</th><th className="px-3 text-right">Выручка с рекламы</th></tr></thead>
                  <tbody>{selected.campaign.days.slice().reverse().map((day) => <tr key={day.ts} className="h-8 border-t border-slate-100"><td className="px-3 text-slate-500">{day.ts}</td><td className="px-3 text-right tabular-nums">{day.views.toLocaleString("ru-RU")}</td><td className="px-3 text-right tabular-nums">{day.clicks.toLocaleString("ru-RU")}</td><td className="px-3 text-right font-medium tabular-nums">{rub(day.spend)}</td><td className="px-3 text-right tabular-nums">{rub(day.orders)}</td></tr>)}</tbody>
                </table>
                {selected.campaign.days.length === 0 ? <div className="border-t border-slate-100 px-3 py-8 text-center text-xs text-slate-400">Посуточная статистика ещё не синхронизирована.</div> : null}
              </div>

              {cabinetId === "all" ? <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800"><WalletCards className="h-4 w-4 shrink-0" /> В режиме «Все кабинеты» ставки, бюджеты и статусы доступны только для чтения.</div> : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
