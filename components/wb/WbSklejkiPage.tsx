"use client";

import { Copy, Link2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import { useDashboardFilter } from "@/lib/useDashboardFilter";
import {
  glueSortedGroups,
  glueSortedSkus,
  glueSummary,
  glueTotals,
  glueVerdict,
  sklejkiPeriod,
  type GlueVerdictKind,
  type SklejkiGroup,
  type SklejkiSkuMetrics,
} from "@/lib/wb/sklejki";
import { WbProductImage } from "./WbProductImage";
import { WbEmptyState, WbErrorState, WbModuleHeader } from "./WbModuleHeader";
import { useWbCabinet } from "./WbCabinetContext";

interface SklejkiData {
  groups_multi: SklejkiGroup[];
  groups_solo: SklejkiGroup[];
  total_sku: number;
  multi_groups: number;
  solo_skus: number;
  covered: number;
  error?: string;
}

const VERDICT_STYLE: Record<GlueVerdictKind, { row: string; badge: string; action: string; dot: string }> = {
  green: { row: "border-emerald-300 bg-emerald-50", badge: "bg-emerald-600 text-white", action: "font-semibold text-emerald-700", dot: "🟢" },
  red: { row: "border-red-300 bg-red-50", badge: "bg-red-600 text-white", action: "font-semibold text-red-700", dot: "🔴" },
  amber: { row: "border-amber-300 bg-amber-50", badge: "bg-amber-500 text-white", action: "font-semibold text-amber-700", dot: "🟠" },
  gray: { row: "border-slate-200 bg-slate-100 opacity-70", badge: "bg-slate-400 text-white", action: "text-slate-400", dot: "🟡" },
  slate: { row: "border-slate-200 bg-white", badge: "bg-slate-200 text-slate-700", action: "text-slate-500", dot: "⚪" },
};

const fmt = (value: number) => Math.round(value).toLocaleString("ru-RU");
const money = (value: number, emptyDash = false) => emptyDash && !value ? "—" : `${fmt(value)}₽`;
const percent = (value: number | null) => value == null ? "∞" : `${value}%`;

function shopBadge(shop: string) {
  return /joy|jc/i.test(shop)
    ? "bg-purple-100 text-purple-700"
    : "bg-blue-100 text-blue-700";
}

function copyValue(value: string | number) {
  void navigator.clipboard?.writeText(String(value));
}

function CopyButton({ value, label }: { value: string | number; label: string }) {
  return (
    <button
      type="button"
      onClick={() => copyValue(value)}
      className="grid h-6 w-6 shrink-0 place-items-center rounded text-slate-400 hover:bg-white hover:text-violet-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
      aria-label={label}
      title={label}
    >
      <Copy className="h-3 w-3" />
    </button>
  );
}

function Metric({ label, value, tone = "text-slate-900", title }: { label: string; value: string; tone?: string; title?: string }) {
  return (
    <div>
      <div title={title} className="mb-0.5 text-[9px] uppercase leading-none tracking-wide text-slate-400">{label}</div>
      <div className={`whitespace-nowrap text-[15px] font-extrabold leading-none tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function SkuCard({ group, sku, verdictVisible = true }: { group: SklejkiGroup; sku: SklejkiSkuMetrics; verdictVisible?: boolean }) {
  const verdict = glueVerdict(group, sku);
  const style = verdictVisible ? VERDICT_STYLE[verdict.kind] : VERDICT_STYLE.slate;
  const wbUrl = `https://www.wildberries.ru/catalog/${sku.nm}/detail.aspx`;
  return (
    <article className={`rounded-md border p-2 ${style.row}`}>
      <div className="flex items-start gap-2">
        <a href={wbUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
          <WbProductImage nm={sku.nm} src={sku.img_url} className="h-10 w-10 rounded bg-slate-100 object-cover" />
        </a>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-0.5">
            <a href={wbUrl} target="_blank" rel="noopener noreferrer" className="truncate text-xs font-medium text-violet-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">{sku.art || sku.nm}</a>
            <CopyButton value={sku.art || sku.nm} label="Скопировать артикул" />
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
            <button type="button" onClick={() => copyValue(sku.nm)} className="hover:text-violet-600">{sku.nm}</button>
            {sku.nm_feedbacks != null ? (
              <span className={sku.nm_feedbacks === 0 ? "font-semibold text-orange-600" : undefined}>
                <span className="text-amber-500">★</span> {sku.nm_rating || 0} ({sku.nm_feedbacks})
              </span>
            ) : null}
          </div>
        </div>
        <span className={`shrink-0 rounded px-1 py-0 text-[9px] ${shopBadge(sku.shop)}`}>{sku.shop}</span>
        {verdictVisible ? <span className={`shrink-0 rounded px-1.5 py-0 text-[9px] font-bold ${style.badge}`}>{verdict.tag}{verdict.share ? ` ${verdict.share}%` : ""}</span> : null}
      </div>

      {sku.signal === "Без трафика" ? <div className="mt-1.5"><span className="inline-block rounded bg-red-200 px-1.5 py-0.5 text-[10px] font-bold text-red-800">⚠ Нет трафика</span></div> : null}

      <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-2 sm:grid-cols-4">
        <Metric label="Показы" value={sku.shows_7d ? fmt(sku.shows_7d) : "—"} />
        <Metric label="Заказы, шт" value={sku.orders_count_7d ? fmt(sku.orders_count_7d) : "—"} />
        <Metric label="Заказы, ₽" value={sku.orders_sum_7d ? money(sku.orders_sum_7d) : "—"} />
        <Metric label="Расход" value={money(sku.adv_spend_7d)} tone={sku.adv_spend_7d > 0 && !sku.orders_sum_7d ? "text-red-600" : undefined} />
        <Metric label="ДРР" value={percent(sku.drr_7d)} tone={sku.drr_7d == null || sku.drr_7d > 10 ? "text-red-600" : undefined} />
        <Metric label="Маржа" title="Маржа до ДРР" value={sku.margin_before_drr == null ? "—" : `${sku.margin_before_drr}%`} tone={sku.margin_before_drr != null && sku.margin_before_drr < 0 ? "text-red-600" : sku.margin_before_drr != null && sku.margin_before_drr < 15 ? "text-amber-600" : undefined} />
        <Metric label="Остаток" value={fmt(sku.stock)} tone={sku.stock < 50 ? "text-red-600" : undefined} />
      </div>

      {verdictVisible ? <div className={`mt-1 text-[10px] leading-tight ${style.action}`}>{style.dot} {verdict.action}</div> : null}
    </article>
  );
}

function GroupCard({ group }: { group: SklejkiGroup }) {
  const totals = glueTotals(group);
  const summary = glueSummary(group);
  return (
    <article className="w-[380px] max-w-[calc(100vw-2rem)] shrink-0 rounded-lg border border-purple-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-base font-bold text-slate-900">{group.shop_label || "—"}</span>
        {group.category_label ? <><span className="text-base font-bold text-slate-900">·</span><span className="min-w-0 truncate text-base font-bold text-slate-900">{group.category_label}</span></> : null}
        <span className="rounded bg-purple-100 px-2 py-0.5 text-xs text-purple-700">{group.skus.length} карточек</span>
        {summary.carry ? <span className="rounded bg-emerald-600 px-1.5 py-0 text-[10px] font-semibold text-white">🟢 несущих {summary.carry}</span> : null}
        <button type="button" onClick={() => copyValue(group.imt_id)} className="text-[10px] text-slate-400 hover:text-violet-600 hover:underline" title="Скопировать imtID">imt {group.imt_id}</button>
        {group.feedback_count && !group.hide_group_rating ? <span className="ml-auto text-xs"><span className="text-amber-500">★</span> <b>{group.valuation}</b> <span className="text-slate-500">({group.feedback_count} общих)</span></span> : null}
      </div>

      <div className="mb-2 grid grid-cols-2 gap-x-3 gap-y-2 border-b-2 border-slate-200 pb-2 sm:grid-cols-3">
        <Metric label="Показы" value={totals.shows ? fmt(totals.shows) : "—"} />
        <Metric label="Заказы, шт" value={totals.orders_count ? fmt(totals.orders_count) : "—"} />
        <Metric label="Заказы, ₽" value={money(totals.orders_sum, true)} />
        <Metric label="Расход" value={money(totals.spend, true)} tone={totals.spend > 0 && !totals.orders_sum ? "text-red-600" : undefined} />
        <Metric label="ДРР" value={percent(totals.drr)} tone={totals.drr == null || totals.drr > 10 ? "text-red-600" : undefined} />
      </div>

      <div className="space-y-1">{glueSortedSkus(group).map((sku) => <SkuCard key={sku.nm} group={group} sku={sku} />)}</div>
    </article>
  );
}

function SoloCard({ group }: { group: SklejkiGroup }) {
  const sku = group.skus[0];
  return sku ? <SkuCard group={group} sku={sku} verdictVisible={false} /> : null;
}

export function WbSklejkiPage() {
  const { activeCabinet, cabinetId, cabinets, ready, loading: cabinetsLoading, error: cabinetsError } = useWbCabinet();
  const [data, setData] = useState<SklejkiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [shop, setShop] = useDashboardFilter<string>("shop", "");
  const requestId = useRef(0);
  const forceRefreshRef = useRef(false);
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
    setLoading(true);
    setError(null);
    const mode = forceRefreshRef.current ? "refresh=1" : "background=1";
    forceRefreshRef.current = false;
    fetch(`/api/sklejki?cabinet=${encodeURIComponent(cabinetId || "all")}&${mode}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as SklejkiData;
        if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
        return body;
      })
      .then((body) => {
        if (current !== requestId.current) return;
        if (body.error) throw new Error(body.error);
        setData(body);
      })
      .catch((cause: unknown) => {
        if (current === requestId.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить склейки");
      })
      .finally(() => {
        if (current === requestId.current) setLoading(false);
      });
    return () => controller.abort();
  }, [cabinetId, cabinets.length, cabinetsError, cabinetsLoading, ready, reloadKey]);

  const shops = useMemo(() => Array.from(new Set([...(data?.groups_multi ?? []), ...(data?.groups_solo ?? [])].map((group) => group.shop_label))).filter(Boolean), [data]);
  useEffect(() => {
    if (shop && data && !shops.includes(shop)) setShop("");
  }, [data, setShop, shop, shops]);
  const multi = useMemo(() => glueSortedGroups((data?.groups_multi ?? []).filter((group) => !shop || group.shop_label === shop)), [data?.groups_multi, shop]);
  const solo = useMemo(() => glueSortedGroups((data?.groups_solo ?? []).filter((group) => !shop || group.shop_label === shop)), [data?.groups_solo, shop]);

  return (
    <div className="min-h-[calc(100vh-54px)] bg-[#f6f7f9] pb-16 md:pb-5">
      <WbModuleHeader
        icon={Link2}
        title="Склейки"
        description={data ? `${data.total_sku} SKU, ${data.multi_groups} склеек, ${data.solo_skus} одиночных, покрыто ${data.covered}/${data.total_sku}` : "Объединённые карточки по imtID"}
        actions={
          <>
            <span title="Показы, заказы, расход и ДРР берутся из РНП за последние 7 закрытых дней" className="rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-[10px] font-medium text-violet-700">данные из РНП · показы/заказы/ДРР за {sklejkiPeriod()}</span>
            {shops.length > 1 ? (
              <div className="flex items-center gap-1 text-[10px]" aria-label="Фильтр кабинета">
                <span className="text-slate-400">кабинет:</span>
                {["", ...shops].map((value) => (
                  <button key={value || "all"} type="button" onClick={() => setShop(value)} className={`min-h-11 rounded-lg px-2 font-semibold transition-colors sm:min-h-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${shop === value ? "bg-violet-600 text-white" : value ? shopBadge(value) : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{value || "Все"}</button>
                ))}
              </div>
            ) : null}
            <button type="button" onClick={() => { forceRefreshRef.current = true; setReloadKey((value) => value + 1); }} disabled={loading} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[11px] font-semibold text-slate-500 sm:min-h-8 hover:text-violet-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-wait"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} /> Обновить</button>
          </>
        }
      />

      <div className="px-2 py-3 sm:px-6">
        {loading ? (
          <>
            <LoadingBanner seconds={elapsed} hint={`imtID через WB · ${activeCabinet?.name ?? "все кабинеты"}`} />
            <SkeletonTableRows rows={8} cols={7} />
          </>
        ) : error ? (
          <WbErrorState message={error} onRetry={() => setReloadKey((value) => value + 1)} />
        ) : !data ? null : data.total_sku === 0 ? (
          <WbEmptyState>В выбранном кабинете нет карточек WB.</WbEmptyState>
        ) : (
          <>
            <h2 className="mb-2 mt-4 first:mt-0 text-sm font-bold text-slate-700">Склейки с несколькими SKU ({multi.length})</h2>
            {multi.length ? <div className="flex snap-x snap-mandatory items-start gap-3 overflow-x-auto pb-3">{multi.map((group) => <div key={`${group.shop_label}-${group.imt_id}`} className="snap-start"><GroupCard group={group} /></div>)}</div> : <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-xs text-slate-400">Для выбранного кабинета нет склеек с несколькими SKU.</div>}

            <h2 className="mb-2 mt-4 first:mt-0 text-sm font-bold text-slate-700">Одиночные SKU ({solo.length})</h2>
            {solo.length ? <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">{solo.map((group) => <SoloCard key={`${group.shop_label}-${group.imt_id}`} group={group} />)}</div> : <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-xs text-slate-400">Для выбранного кабинета нет одиночных SKU.</div>}
          </>
        )}
      </div>
    </div>
  );
}
