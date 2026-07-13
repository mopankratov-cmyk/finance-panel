"use client";

import { Layers3, Link2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import { useCategoryMap } from "@/lib/useCategoryMap";
import { useSort, sortGlyph } from "@/lib/useSort";
import { WbEmptyState, WbErrorState, WbModuleHeader } from "./WbModuleHeader";
import { useWbCabinet } from "./WbCabinetContext";

interface GroupSku {
  nm: number;
  art: string;
  name: string;
  img_url: string;
  shop: string;
  shows_7d: number;
  orders_sum_7d: number;
  adv_spend_7d: number;
  drr_7d: number | null;
  margin_before_drr: number | null;
  stock: number;
  signal: string | null;
  nm_rating: number | null;
  nm_feedbacks: number | null;
}

interface SkuGroup {
  imt_id: number;
  shop_label: string;
  category_label: string;
  skus: GroupSku[];
}

interface SklejkiData {
  groups_multi: SkuGroup[];
  groups_solo: SkuGroup[];
  total_sku: number;
  multi_groups: number;
  solo_skus: number;
  covered: number;
  error?: string;
}

const fmt = (value: number) => Math.round(value).toLocaleString("ru-RU");
const pct = (value: number | null) => value == null ? "—" : `${Math.round(value * 10) / 10}%`;

function drrTone(value: number | null) {
  if (value == null) return "text-slate-400";
  if (value <= 10) return "text-emerald-700";
  if (value <= 20) return "text-amber-600";
  return "font-semibold text-rose-600";
}

function filterGroupList(groups: SkuGroup[], byArticle: Record<string, string>, category: string) {
  return groups.map((group) => ({
    ...group,
    skus: group.skus.filter((sku) => !category || (category === "__none" ? !byArticle[sku.art] : byArticle[sku.art] === category)),
  })).filter((group) => group.skus.length > 0);
}

function GroupPanel({ group }: { group: SkuGroup }) {
  const { sorted: skus, sortField, sortDir, toggleSort } = useSort(group.skus, (sku, field) => field === "art" ? sku.art : sku[field as keyof GroupSku] as number | null);
  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]" style={{ contentVisibility: "auto", containIntrinsicSize: "180px" }}>
      <div className="flex min-h-10 flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5">
        <Layers3 className="h-3.5 w-3.5 text-violet-600" />
        <span className="text-xs font-bold text-slate-700">Склейка {group.imt_id}</span>
        <span className="rounded-md bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">{group.skus.length} SKU</span>
        {group.category_label ? <span className="max-w-60 truncate text-[10px] text-slate-400">{group.category_label}</span> : null}
        <span className="ml-auto rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500">{group.shop_label}</span>
      </div>
      <div className="overflow-x-auto overscroll-x-contain">
        <table className="w-full min-w-[940px] border-collapse text-[11px]">
          <thead>
            <tr className="h-7 bg-white text-[9px] uppercase tracking-wide text-slate-400">
              <th onClick={() => toggleSort("art")} className="min-w-[250px] cursor-pointer select-none border-b border-r border-slate-100 px-3 text-left font-semibold hover:text-violet-600">Артикул{sortGlyph(sortField === "art", sortDir)}</th>
              <th onClick={() => toggleSort("nm_rating")} className="cursor-pointer select-none border-b border-r border-slate-100 px-2 text-right font-semibold hover:text-violet-600">Рейтинг{sortGlyph(sortField === "nm_rating", sortDir)}</th>
              {([[
                "shows_7d", "Показы",
              ], ["orders_sum_7d", "Выручка ₽"], ["adv_spend_7d", "Реклама ₽"], ["drr_7d", "ДРР"], ["margin_before_drr", "Маржа"], ["stock", "Остаток"]] as [keyof GroupSku, string][]).map(([field, label]) => (
                <th key={field} onClick={() => toggleSort(field)} className="cursor-pointer select-none border-b border-r border-slate-100 px-2 text-right font-semibold last:border-r-0 hover:text-violet-600">{label}{sortGlyph(sortField === field, sortDir)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {skus.map((sku) => (
              <tr key={sku.nm} className="group h-[43px] border-b border-slate-100 last:border-b-0 hover:bg-violet-50/25">
                <td className="border-r border-slate-100 px-3">
                  <div className="flex min-w-0 items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={sku.img_url} alt="" loading="lazy" className="h-8 w-8 shrink-0 rounded-md border border-slate-100 bg-slate-50 object-cover" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
                    <div className="min-w-0"><div className="truncate font-semibold text-slate-700">{sku.art}</div><div className="max-w-48 truncate text-[9px] text-slate-400">{sku.name}</div></div>
                    {sku.signal ? <span className="ml-auto rounded-md bg-rose-50 px-1.5 py-0.5 text-[9px] font-medium text-rose-600">{sku.signal}</span> : null}
                  </div>
                </td>
                <td className="border-r border-slate-100 px-2 text-right tabular-nums text-slate-500">{sku.nm_rating == null ? "—" : <><span className="text-amber-500">★ {sku.nm_rating}</span>{sku.nm_feedbacks != null ? <span className="text-slate-400"> ({sku.nm_feedbacks})</span> : null}</>}</td>
                <td className="border-r border-slate-100 px-2 text-right tabular-nums">{fmt(sku.shows_7d)}</td>
                <td className="border-r border-slate-100 px-2 text-right tabular-nums">{fmt(sku.orders_sum_7d)}</td>
                <td className="border-r border-slate-100 px-2 text-right tabular-nums">{fmt(sku.adv_spend_7d)}</td>
                <td className={`border-r border-slate-100 px-2 text-right tabular-nums ${drrTone(sku.drr_7d)}`}>{pct(sku.drr_7d)}</td>
                <td className={`border-r border-slate-100 px-2 text-right tabular-nums ${sku.margin_before_drr != null && sku.margin_before_drr < 10 ? "text-rose-600" : "text-emerald-700"}`}>{pct(sku.margin_before_drr)}</td>
                <td className={`px-2 text-right tabular-nums ${sku.stock < 10 ? "text-rose-600" : "text-slate-600"}`}>{fmt(sku.stock)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

export function WbSklejkiPage() {
  const { activeCabinet, cabinetId, cabinets, ready, loading: cabinetsLoading, error: cabinetsError } = useWbCabinet();
  const [data, setData] = useState<SklejkiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [view, setView] = useState<"multi" | "solo">("multi");
  const [category, setCategory] = useState("");
  const requestId = useRef(0);
  const elapsed = useElapsedSeconds(loading);
  const { categories, byArticle } = useCategoryMap();

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
    fetch(`/api/sklejki?cabinet=${encodeURIComponent(cabinetId || "all")}`, { cache: "no-store", signal: controller.signal })
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
  }, [cabinetId, cabinets.length, cabinetsError, cabinetsLoading, ready, retryKey]);

  const multi = useMemo(() => filterGroupList(data?.groups_multi ?? [], byArticle, category), [byArticle, category, data?.groups_multi]);
  const solo = useMemo(() => filterGroupList(data?.groups_solo ?? [], byArticle, category), [byArticle, category, data?.groups_solo]);
  const groups = view === "multi" ? multi : solo;

  return (
    <div className="min-h-[calc(100vh-54px)] bg-[#f6f7f9] pb-16 md:pb-5">
      <WbModuleHeader
        icon={Link2}
        title="Склейки"
        description={data ? `${data.total_sku} SKU · ${data.multi_groups} склеек · ${data.solo_skus} одиночных · покрыто ${data.covered}/${data.total_sku}` : "Объединённые карточки по imtID"}
        actions={
          <>
            <span className="hidden rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[10px] font-medium text-violet-600 sm:inline-flex">данные из РНП · показы / заказы / ДРР за 7 дней</span>
            {categories.length ? (
              <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Категория" className="min-h-11 max-w-44 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] text-slate-600 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 sm:min-h-8">
                <option value="">Все категории</option>
                {categories.map((item) => <option key={item} value={item}>{item}</option>)}
                <option value="__none">Без категории</option>
              </select>
            ) : null}
            <button type="button" onClick={() => setRetryKey((value) => value + 1)} disabled={loading} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-[11px] font-medium text-slate-500 transition-colors hover:bg-white hover:text-violet-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-wait sm:min-h-8"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} /> Обновить</button>
          </>
        }
      />

      <div className="px-2 py-3 sm:px-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setView("multi")} className={`min-h-11 rounded-lg px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:min-h-8 ${view === "multi" ? "bg-violet-600 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>Склейки с несколькими SKU ({multi.length})</button>
          <button type="button" onClick={() => setView("solo")} className={`min-h-11 rounded-lg px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:min-h-8 ${view === "solo" ? "bg-violet-600 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>Одиночные SKU ({solo.length})</button>
          <span className="ml-auto text-[10px] text-slate-400">{activeCabinet?.name ?? "Все кабинеты"}</span>
        </div>

        {loading ? (
          <>
            <LoadingBanner seconds={elapsed} hint={`imtID через WB · ${activeCabinet?.name ?? "все кабинеты"}`} />
            <SkeletonTableRows rows={8} cols={7} />
          </>
        ) : error ? (
          <WbErrorState message={error} onRetry={() => setRetryKey((value) => value + 1)} />
        ) : groups.length === 0 ? (
          <WbEmptyState>{category ? "В выбранной категории нет карточек этого типа." : view === "multi" ? "Нет объединённых карточек с несколькими SKU." : "Нет одиночных SKU."}</WbEmptyState>
        ) : (
          <div className="space-y-3">{groups.map((group) => <GroupPanel key={`${group.shop_label}-${group.imt_id}`} group={group} />)}</div>
        )}
      </div>
    </div>
  );
}
