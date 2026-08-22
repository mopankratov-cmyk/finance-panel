"use client";

import { ChevronRight, ClipboardList, Download, Loader2, PlayCircle, RefreshCw } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import {
  WB_RK_BLOCKS,
  WB_RK_BLOCK_ATTRIBUTED,
  WB_RK_BLOCK_ATTRIBUTED_LABEL,
  WB_RK_BLOCK_LABELS,
  WB_RK_BLOCK_UNKNOWN,
  WB_RK_BLOCK_UNKNOWN_LABEL,
  type WbRkBlock,
} from "@/lib/wb/advertBlocks";
import { costPerCart, costPerOrder, cplTone, cpoTone, WB_RK_TONE_CLASS } from "@/lib/wb/rkThresholds";
import { sortByCustomSkuOrder } from "@/lib/wb/skuOrder";
import { useCabinetSkuOrder } from "@/lib/wb/useCabinetSkuOrder";
import { nmMatchesTags, useRnpTags, WbTagFilterChips } from "./useRnpTags";
import { displaySkuName, useWbSkuNames } from "./useWbSkuNames";
import { useWbCabinet } from "./WbCabinetContext";
import { WbEmptyState, WbErrorState, WbModuleHeader } from "./WbModuleHeader";

interface DayCell {
  bid: number | null;
  views: number;
  clicks: number;
  spent: number;
  spentAllocated: number;
  carts: number;
  orders: number;
  ordersSum: number;
  snapshot: boolean;
}

interface JournalCampaign {
  advertId: number | null;
  name: string | null;
  block: string;
  /** Сколько артикулов ведёт кампания: её имя бывает от соседнего товара. */
  nmCount: number | null;
  days: Record<string, DayCell>;
}

interface JournalItem {
  nm: number;
  /** Итог по артикулу за день — сумма его кампаний. */
  days: Record<string, DayCell>;
  campaigns: JournalCampaign[];
}

interface JournalData {
  notes?: string[];
  from: string;
  to: string;
  dates: string[];
  items: JournalItem[];
  snapshotDates: string[];
}

const DAY_OPTIONS = [5, 7, 14, 30];
// Сколько срезов кампаний добираем за одно нажатие. Больше — упрёмся в лимиты
// WB и в терпение: у кабинета на тысячу кампаний полный круг это ~24 среза.
const SYNC_MAX_PASSES = 8;

const money = (value: number | null) => value == null ? "—" : Math.round(value).toLocaleString("ru-RU");
const money2 = (value: number | null) => value == null ? "—" : value.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const count = (value: number | null) => value == null ? "—" : value.toLocaleString("ru-RU");
const dayLabel = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/** Пустая ячейка — это «рекламы не было», а не ноль расходов. */
function isEmpty(cell: DayCell | undefined) {
  return !cell || (cell.spent === 0 && cell.views === 0 && cell.clicks === 0 && cell.carts === 0 && cell.orders === 0);
}

function ToneCell({ value, tone, fraction }: { value: number | null; tone: string | null; fraction?: boolean }) {
  const text = value == null ? "—" : fraction ? money2(value) : money(value);
  return (
    <td className={`whitespace-nowrap px-2 py-1 text-right tabular-nums ${tone ? WB_RK_TONE_CLASS[tone as "green"] : "text-slate-700"}`}>
      {text}
    </td>
  );
}

export function WbRkJournalPage() {
  const { cabinetId, hasExactCabinet, ready, canWrite } = useWbCabinet();
  const [days, setDays] = useState(5);
  const [data, setData] = useState<JournalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTagIds, setActiveTagIds] = useState<string[]>([]);
  const [blockFilter, setBlockFilter] = useState<string>("all");
  const [syncing, setSyncing] = useState<string | null>(null);
  const [openNms, setOpenNms] = useState<Set<number>>(new Set());
  const elapsed = useElapsedSeconds(loading);

  const { tags, tagIdsByNm } = useRnpTags(hasExactCabinet ? cabinetId : null);
  const skuNames = useWbSkuNames(hasExactCabinet ? cabinetId : null);
  const { orderIndex } = useCabinetSkuOrder(hasExactCabinet ? cabinetId : null);

  const load = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (cabinetId) params.set("cabinet", cabinetId);
      const response = await fetch(`/api/wb/rk-journal?${params}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
      setData(body as JournalData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить журнал");
    } finally {
      setLoading(false);
    }
  }, [cabinetId, days, ready]);

  useEffect(() => { void load(); }, [load]);

  // Ручной прогон синка рекламы: крон ходит раз в час и берёт очередной срез
  // кампаний, а когда цифры нужны сейчас, ждать нечего.
  const runSync = async () => {
    setError(null);
    try {
      const params = cabinetId ? `?cabinet=${encodeURIComponent(cabinetId)}` : "";
      // Один вызов берёт очередной срез кампаний (у WB между срезами пауза на
      // лимит), поэтому гоняем подряд, пока обход не замкнёт круг. Без этого
      // расход журнала отстаёт от кабинетного ровно на необойдённые кампании.
      for (let pass = 1; pass <= SYNC_MAX_PASSES; pass++) {
        setSyncing(`Прогон ${pass}: тянем статистику кампаний из WB…`);
        const response = await fetch(`/api/sync/advert-stats${params}`, { cache: "no-store" });
        const body = await response.json().catch(() => ({})) as {
          error?: string;
          progress?: Array<{ cabinet?: string; coveragePct?: number; nextBatch?: number; batches?: number; status?: string }>;
        };
        if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
        const progress = body.progress?.[0];
        const coverage = progress?.coveragePct ?? 100;
        setSyncing(`Прогон ${pass}: собрано ${coverage}% кампаний кабинета…`);
        // Круг замкнулся (nextBatch вернулся в начало) либо кампаний мало.
        if (!progress || progress.nextBatch === 0 || (progress.batches ?? 1) <= 1) break;
        if (progress.status === "rate_limited") {
          setError("WB притормозил выдачу статистики — часть кампаний доберёт следующий прогон.");
          break;
        }
      }
      setSyncing("Обновляем журнал…");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось прогнать синхронизацию");
    } finally {
      setSyncing(null);
    }
  };

  const dates = data?.dates ?? [];

  const visibleItems = useMemo(() => {
    const items = (data?.items ?? []).filter((item) => nmMatchesTags(tagIdsByNm, item.nm, activeTagIds));
    const byBlock = blockFilter === "all"
      ? items
      : items.filter((item) => item.campaigns.some((campaign) => campaign.block === blockFilter));
    return sortByCustomSkuOrder(byBlock, (item) => item.nm, orderIndex);
  }, [activeTagIds, blockFilter, data?.items, orderIndex, tagIdsByNm]);

  // Сводка по видам размещения: числитель и знаменатель складываются отдельно,
  // среднее из процентов по строкам дало бы неверный CPO/CPL.
  const blockSummary = useMemo(() => {
    const acc = new Map<string, { spent: number; allocated: number; carts: number; orders: number; clicks: number; views: number; ordersSum: number; skus: Set<number> }>();
    for (const item of visibleItems) {
      for (const campaign of item.campaigns) {
      // Конверсии из чужих кампаний вида размещения не имеют: попав в блок,
      // они бы улучшили его CPO заказами, которых он не покупал.
      if (campaign.block === WB_RK_BLOCK_ATTRIBUTED) continue;
      const agg = acc.get(campaign.block) ?? { spent: 0, allocated: 0, carts: 0, orders: 0, clicks: 0, views: 0, ordersSum: 0, skus: new Set<number>() };
      for (const cell of Object.values(campaign.days)) {
        agg.spent += cell.spent;
        agg.allocated += cell.spentAllocated ?? 0;
        agg.carts += cell.carts;
        agg.orders += cell.orders;
        agg.clicks += cell.clicks;
        agg.views += cell.views;
        agg.ordersSum += cell.ordersSum;
      }
      agg.skus.add(item.nm);
      acc.set(campaign.block, agg);
      }
    }
    const order = [...WB_RK_BLOCKS, WB_RK_BLOCK_UNKNOWN];
    return order
      .filter((block) => acc.has(block))
      .map((block) => {
        const agg = acc.get(block)!;
        return {
          block,
          label: block === WB_RK_BLOCK_UNKNOWN ? WB_RK_BLOCK_UNKNOWN_LABEL : WB_RK_BLOCK_LABELS[block as WbRkBlock],
          spent: agg.spent,
          allocated: agg.allocated,
          carts: agg.carts,
          orders: agg.orders,
          skus: agg.skus.size,
          cpo: costPerOrder(agg.spent, agg.orders),
          cpl: costPerCart(agg.spent, agg.carts),
          cpc: agg.clicks ? agg.spent / agg.clicks : null,
          cpm: agg.views ? (agg.spent / agg.views) * 1000 : null,
          drr: agg.ordersSum ? (agg.spent / agg.ordersSum) * 100 : null,
        };
      });
  }, [visibleItems]);

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const seen = new Set<string>();
    for (const item of data?.items ?? []) {
      for (const tagId of tagIdsByNm.get(item.nm) ?? []) {
        const key = `${tagId}|${item.nm}`;
        if (seen.has(key)) continue;
        seen.add(key);
        counts.set(tagId, (counts.get(tagId) ?? 0) + 1);
      }
    }
    return counts;
  }, [data?.items, tagIdsByNm]);

  // Итог по каждому дню — как строка «Итого» в листе владельца: CPO и CPL дня
  // считаются от суммарных затрат и результатов, а не усреднением по строкам.
  const dayTotals = useMemo(() => {
    const acc = new Map<string, { spent: number; carts: number; orders: number }>();
    for (const item of visibleItems) {
      for (const [date, cell] of Object.entries(item.days)) {
        const agg = acc.get(date) ?? { spent: 0, carts: 0, orders: 0 };
        agg.spent += cell.spent;
        agg.carts += cell.carts;
        agg.orders += cell.orders;
        acc.set(date, agg);
      }
    }
    return acc;
  }, [visibleItems]);

  // Выгрузка повторяет раскладку ручного листа: по дню шесть колонок в том же
  // порядке. На переходный период команда сверяет журнал со своей таблицей.
  const exportCsv = () => {
    if (!data) return;
    const header = ["Артикул", "Название", "Кампания", "Вид размещения", ...dates.flatMap((date) => [
      `${dayLabel(date)} ставка`, `${dayLabel(date)} корзин`, `${dayLabel(date)} заказов`,
      `${dayLabel(date)} затраты`, `${dayLabel(date)} CPO`, `${dayLabel(date)} CPL`,
    ])];
    const num = (value: number | null) => value == null ? "" : String(Math.round(value * 100) / 100);

    const rows = visibleItems.flatMap((item) => {
      const name = displaySkuName("", null, skuNames, item.nm);
      return item.campaigns.map((campaign) => [
        String(item.nm),
        name,
        campaign.block === WB_RK_BLOCK_ATTRIBUTED
          ? WB_RK_BLOCK_ATTRIBUTED_LABEL
          : campaign.name ?? (campaign.advertId ? `Кампания ${campaign.advertId}` : ""),
        campaign.block === WB_RK_BLOCK_ATTRIBUTED ? ""
          : campaign.block === WB_RK_BLOCK_UNKNOWN ? WB_RK_BLOCK_UNKNOWN_LABEL
            : WB_RK_BLOCK_LABELS[campaign.block as WbRkBlock],
        ...dates.flatMap((date) => {
          const cell = campaign.days[date];
          if (isEmpty(cell)) return ["", "", "", "", "", ""];
          return [
            num(cell.bid), String(cell.carts), String(cell.orders), num(cell.spent),
            num(costPerOrder(cell.spent, cell.orders)), num(costPerCart(cell.spent, cell.carts)),
          ];
        }),
      ]);
    });
    const csv = [header, ...rows]
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(";"))
      .join("\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `rk-journal-${data.from}-${data.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex min-h-0 flex-col">
      <WbModuleHeader
        icon={ClipboardList}
        title="Журнал РК"
        description={data
          ? `${data.from} — ${data.to} · снимок в 06:00 МСК за предыдущий день`
          : "Ставка, корзины, заказы, затраты, CPO и CPL по дням"}
        actions={(
          <>
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5">
              {DAY_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setDays(option)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${days === option ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
                >
                  {option} дн
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void runSync()}
              disabled={!canWrite || syncing != null || loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-900 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
              Прогнать РК
            </button>
            <button
              type="button"
              onClick={exportCsv}
              disabled={!data || !visibleItems.length}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </button>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Обновить
            </button>
          </>
        )}
      />

      <div className="min-h-0 flex-1 overflow-auto px-3 py-3 sm:px-6">
        {error ? <WbErrorState message={error} onRetry={() => void load()} /> : null}
        {data?.notes?.length ? (
          <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            Часть данных не прочиталась, цифры ниже неполные: {data.notes.join("; ")}
          </div>
        ) : null}
        {syncing ? (
          <div className="mb-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
            {syncing} Прогон берёт очередной срез кампаний — на весь кабинет их несколько.
          </div>
        ) : null}
        {loading && !data ? <LoadingBanner seconds={elapsed} hint="Собираем журнал РК" /> : null}

        {data ? (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
              {blockSummary.map((summary) => (
                <button
                  key={summary.block}
                  type="button"
                  onClick={() => setBlockFilter(blockFilter === summary.block ? "all" : summary.block)}
                  className={`rounded-xl border p-2.5 text-left transition ${blockFilter === summary.block ? "border-slate-900 bg-white shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"}`}
                >
                  <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">{summary.label}</div>
                  <div className="mt-1 text-lg font-bold tabular-nums text-slate-900">{money(summary.spent)} ₽</div>
                  <dl className="mt-1 space-y-0.5 text-[11px] text-slate-500">
                    <div className="flex justify-between gap-2">
                      <dt>CPO</dt>
                      <dd className={`rounded px-1 font-medium tabular-nums ${cpoTone(summary.cpo) ? WB_RK_TONE_CLASS[cpoTone(summary.cpo)!] : ""}`}>{money2(summary.cpo)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>CPL</dt>
                      <dd className={`rounded px-1 font-medium tabular-nums ${cplTone(summary.cpl) ? WB_RK_TONE_CLASS[cplTone(summary.cpl)!] : ""}`}>{money2(summary.cpl)}</dd>
                    </div>
                    <div className="flex justify-between gap-2"><dt>CPC</dt><dd className="tabular-nums">{money2(summary.cpc)}</dd></div>
                    <div className="flex justify-between gap-2"><dt>CPM</dt><dd className="tabular-nums">{money(summary.cpm)}</dd></div>
                    <div className="flex justify-between gap-2"><dt>ДРР</dt><dd className="tabular-nums">{summary.drr == null ? "—" : `${summary.drr.toFixed(1)}%`}</dd></div>
                    <div className="flex justify-between gap-2"><dt>Корзин / заказов</dt><dd className="tabular-nums">{count(summary.carts)} / {count(summary.orders)}</dd></div>
                    <div className="flex justify-between gap-2"><dt>Артикулов</dt><dd className="tabular-nums">{count(summary.skus)}</dd></div>
                    {summary.allocated > 0 ? (
                      // WB отдаёт часть расхода только суммой по кампании: эта
                      // доля разложена по артикулам пропорционально показам.
                      <div className="flex justify-between gap-2 text-slate-400">
                        <dt>из них разложено</dt>
                        <dd className="tabular-nums">{money(summary.allocated)} ₽</dd>
                      </div>
                    ) : null}
                  </dl>
                </button>
              ))}
            </div>

            {tags.length ? (
              <div className="mb-3">
                <WbTagFilterChips
                  tags={tags}
                  activeIds={activeTagIds}
                  counts={tagCounts}
                  onToggle={(id) => setActiveTagIds((prev) => prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id])}
                  onClear={() => setActiveTagIds([])}
                />
              </div>
            ) : null}

            {visibleItems.length ? (
              <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
                <table className="min-w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500">
                      <th className="sticky left-0 z-10 bg-slate-50 px-2 py-1.5 text-left font-medium">Артикул</th>
                      <th className="px-2 py-1.5 text-left font-medium">Кампании</th>
                      {dates.map((date) => (
                        <th key={date} colSpan={6} className="border-l border-slate-200 px-2 py-1.5 text-center font-semibold text-slate-700">
                          {dayLabel(date)}
                          {data.snapshotDates.includes(date) ? null : <span className="ml-1 font-normal text-slate-400">live</span>}
                        </th>
                      ))}
                    </tr>
                    <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400">
                      <th className="sticky left-0 z-10 bg-slate-50 px-2 pb-1.5" />
                      <th className="px-2 pb-1.5" />
                      {dates.map((date) => (
                        <Fragment key={date}>
                          <th className="border-l border-slate-200 px-2 pb-1.5 text-right font-normal">Ставка</th>
                          <th className="px-2 pb-1.5 text-right font-normal">Корзин</th>
                          <th className="px-2 pb-1.5 text-right font-normal">Заказов</th>
                          <th className="px-2 pb-1.5 text-right font-normal">Затраты</th>
                          <th className="px-2 pb-1.5 text-right font-normal">CPO</th>
                          <th className="px-2 pb-1.5 text-right font-normal">CPL</th>
                        </Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleItems.map((item) => {
                      const name = displaySkuName("", null, skuNames, item.nm);
                      const open = openNms.has(item.nm);
                      const shown = blockFilter === "all"
                        ? item.campaigns
                        : item.campaigns.filter((campaign) => campaign.block === blockFilter || campaign.block === WB_RK_BLOCK_ATTRIBUTED);
                      return (
                        <Fragment key={item.nm}>
                          <tr
                            className="cursor-pointer bg-white font-medium hover:bg-slate-50/60"
                            onClick={() => setOpenNms((prev) => {
                              const next = new Set(prev);
                              if (next.has(item.nm)) next.delete(item.nm); else next.add(item.nm);
                              return next;
                            })}
                          >
                            <td className="sticky left-0 z-10 bg-white px-2 py-1.5">
                              <div className="flex items-start gap-1.5">
                                <ChevronRight className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`} />
                                <div className="min-w-0">
                                  <div className="tabular-nums text-slate-800">{item.nm}</div>
                                  {name ? <div className="max-w-[220px] truncate text-[11px] font-normal text-slate-500">{name}</div> : null}
                                </div>
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-[11px] font-normal text-slate-500">
                              {shown.length} {shown.length === 1 ? "кампания" : shown.length < 5 ? "кампании" : "кампаний"}
                            </td>
                            {dates.map((date) => {
                              const cell = item.days[date];
                              if (isEmpty(cell)) {
                                return (
                                  <td key={date} colSpan={6} className="border-l border-slate-200 px-2 py-1.5 text-center font-normal text-slate-300">
                                    —
                                  </td>
                                );
                              }
                              const cpo = costPerOrder(cell.spent, cell.orders);
                              const cpl = costPerCart(cell.spent, cell.carts);
                              return (
                                <Fragment key={date}>
                                  {/* Ставка у артикула не показывается: у его кампаний она разная. */}
                                  <td className="border-l border-slate-200 px-2 py-1.5" />
                                  <td className="px-2 py-1.5 text-right tabular-nums">{count(cell.carts)}</td>
                                  <td className="px-2 py-1.5 text-right tabular-nums">{count(cell.orders)}</td>
                                  <td className="px-2 py-1.5 text-right tabular-nums">{money(cell.spent)}</td>
                                  <ToneCell value={cpo} tone={cpoTone(cpo)} fraction />
                                  <ToneCell value={cpl} tone={cplTone(cpl)} fraction />
                                </Fragment>
                              );
                            })}
                          </tr>
                          {open ? shown.map((campaign) => (
                            <tr key={`${item.nm}-${campaign.advertId ?? campaign.block}`} className="bg-slate-50/40 text-slate-600">
                              <td className="sticky left-0 z-10 bg-slate-50/40 py-1 pl-7 pr-2">
                                <div className={`max-w-[240px] truncate text-[11px] ${campaign.block === WB_RK_BLOCK_ATTRIBUTED ? "italic text-slate-400" : ""}`} title={campaign.name ?? undefined}>
                                  {campaign.block === WB_RK_BLOCK_ATTRIBUTED
                                    ? WB_RK_BLOCK_ATTRIBUTED_LABEL
                                    : campaign.name ?? (campaign.advertId ? `Кампания ${campaign.advertId}` : "—")}
                                </div>
                                {campaign.nmCount && campaign.nmCount > 1 ? (
                                  // Имя кампании бывает от соседнего товара — показываем охват.
                                  <div className="text-[10px] text-slate-400">на {campaign.nmCount} артикулов</div>
                                ) : null}
                              </td>
                              <td className="whitespace-nowrap px-2 py-1 text-[11px]">
                                {campaign.block === WB_RK_BLOCK_ATTRIBUTED ? ""
                                  : campaign.block === WB_RK_BLOCK_UNKNOWN ? WB_RK_BLOCK_UNKNOWN_LABEL
                                    : WB_RK_BLOCK_LABELS[campaign.block as WbRkBlock]}
                              </td>
                              {dates.map((date) => {
                                const cell = campaign.days[date];
                                if (isEmpty(cell)) {
                                  return (
                                    <td key={date} colSpan={6} className="border-l border-slate-200 px-2 py-1 text-center text-slate-300">
                                      —
                                    </td>
                                  );
                                }
                                const cpo = costPerOrder(cell.spent, cell.orders);
                                const cpl = costPerCart(cell.spent, cell.carts);
                                return (
                                  <Fragment key={date}>
                                    <td className="border-l border-slate-200 px-2 py-1 text-right tabular-nums">
                                      {cell.bid == null ? "—" : money2(cell.bid)}
                                    </td>
                                    <td className="px-2 py-1 text-right tabular-nums">{count(cell.carts)}</td>
                                    <td className="px-2 py-1 text-right tabular-nums">{count(cell.orders)}</td>
                                    <td className="px-2 py-1 text-right tabular-nums">{money(cell.spent)}</td>
                                    <ToneCell value={cpo} tone={cpoTone(cpo)} fraction />
                                    <ToneCell value={cpl} tone={cplTone(cpl)} fraction />
                                  </Fragment>
                                );
                              })}
                            </tr>
                          )) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 font-semibold text-slate-800">
                      <td className="sticky left-0 z-10 bg-slate-50 px-2 py-1.5">Итого</td>
                      <td className="px-2 py-1.5 font-normal text-slate-500">{visibleItems.length} артикулов</td>
                      {dates.map((date) => {
                        const total = dayTotals.get(date);
                        if (!total || (!total.spent && !total.carts && !total.orders)) {
                          return <td key={date} colSpan={6} className="border-l border-slate-200 px-2 py-1.5 text-center font-normal text-slate-300">—</td>;
                        }
                        const cpo = costPerOrder(total.spent, total.orders);
                        const cpl = costPerCart(total.spent, total.carts);
                        return (
                          <Fragment key={date}>
                            <td className="border-l border-slate-200 px-2 py-1.5" />
                            <td className="px-2 py-1.5 text-right tabular-nums">{count(total.carts)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{count(total.orders)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{money(total.spent)}</td>
                            <ToneCell value={cpo} tone={cpoTone(cpo)} fraction />
                            <ToneCell value={cpl} tone={cplTone(cpl)} fraction />
                          </Fragment>
                        );
                      })}
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : loading ? (
              <SkeletonTableRows rows={8} />
            ) : (
              <WbEmptyState>
                За выбранный период статистики кампаний нет. Она наполняется синхронизацией рекламы —
                первый прогон занимает несколько часов на кабинет.
              </WbEmptyState>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
