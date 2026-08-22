"use client";

import { ClipboardList, Loader2, RefreshCw, Tags } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import {
  WB_RK_BLOCKS,
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
  carts: number;
  orders: number;
  ordersSum: number;
  snapshot: boolean;
}

interface JournalItem {
  nm: number;
  block: string;
  days: Record<string, DayCell>;
}

interface UnmarkedCampaign {
  advertId: number;
  cabinetId: string | null;
  name: string | null;
  status: number | null;
  bidType: string | null;
  bidSearch: number | null;
  bidShelf: number | null;
  nmIds: number[];
}

interface JournalData {
  notes?: string[];
  from: string;
  to: string;
  dates: string[];
  items: JournalItem[];
  unmarked: UnmarkedCampaign[];
  campaigns: number;
  snapshotDates: string[];
}

const DAY_OPTIONS = [5, 7, 14, 30];

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
  const [savingAdvert, setSavingAdvert] = useState<number | null>(null);
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

  const setBlock = async (campaign: UnmarkedCampaign, block: WbRkBlock | "") => {
    setSavingAdvert(campaign.advertId);
    try {
      const response = await fetch("/api/wb/rk-journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ advertId: campaign.advertId, cabinetId: campaign.cabinetId, block: block || null }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Ошибка ${response.status}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить вид размещения");
    } finally {
      setSavingAdvert(null);
    }
  };

  const dates = data?.dates ?? [];

  const visibleItems = useMemo(() => {
    const items = (data?.items ?? []).filter((item) => nmMatchesTags(tagIdsByNm, item.nm, activeTagIds));
    const byBlock = blockFilter === "all" ? items : items.filter((item) => item.block === blockFilter);
    return sortByCustomSkuOrder(byBlock, (item) => item.nm, orderIndex);
  }, [activeTagIds, blockFilter, data?.items, orderIndex, tagIdsByNm]);

  // Сводка по видам размещения: числитель и знаменатель складываются отдельно,
  // среднее из процентов по строкам дало бы неверный CPO/CPL.
  const blockSummary = useMemo(() => {
    const acc = new Map<string, { spent: number; carts: number; orders: number; clicks: number; views: number; ordersSum: number; skus: Set<number> }>();
    for (const item of visibleItems) {
      const agg = acc.get(item.block) ?? { spent: 0, carts: 0, orders: 0, clicks: 0, views: 0, ordersSum: 0, skus: new Set<number>() };
      for (const cell of Object.values(item.days)) {
        agg.spent += cell.spent;
        agg.carts += cell.carts;
        agg.orders += cell.orders;
        agg.clicks += cell.clicks;
        agg.views += cell.views;
        agg.ordersSum += cell.ordersSum;
      }
      agg.skus.add(item.nm);
      acc.set(item.block, agg);
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

  const totals = useMemo(() => {
    const acc = { spent: 0, carts: 0, orders: 0 };
    for (const item of visibleItems) {
      for (const cell of Object.values(item.days)) {
        acc.spent += cell.spent;
        acc.carts += cell.carts;
        acc.orders += cell.orders;
      }
    }
    return { ...acc, cpo: costPerOrder(acc.spent, acc.orders), cpl: costPerCart(acc.spent, acc.carts) };
  }, [visibleItems]);

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
                    <div className="flex justify-between gap-2"><dt>Корзин / заказов</dt><dd className="tabular-nums">{count(summary.carts)} / {count(summary.orders)}</dd></div>
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

            {data.unmarked.length ? (
              <details className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium text-amber-900">
                  <Tags className="mr-1.5 inline h-4 w-4" />
                  Без разметки: {data.unmarked.length} кампаний из {data.campaigns}
                </summary>
                <p className="mt-1.5 text-xs text-amber-800">
                  WB не отдаёт вид размещения кампании. Автоматика разбирает те, где живёт одна ставка —
                  поиска или полок. Остальные разметьте один раз: разметка переживает синхронизации.
                </p>
                <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-amber-200 bg-white">
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-slate-100">
                      {data.unmarked.map((campaign) => (
                        <tr key={`${campaign.cabinetId ?? ""}-${campaign.advertId}`}>
                          <td className="px-2 py-1 text-slate-700">{campaign.name || `Кампания ${campaign.advertId}`}</td>
                          <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums text-slate-500">
                            поиск {money2(campaign.bidSearch)} · полки {money2(campaign.bidShelf)}
                          </td>
                          <td className="px-2 py-1 text-right">
                            <select
                              disabled={!canWrite || savingAdvert === campaign.advertId}
                              defaultValue=""
                              onChange={(event) => void setBlock(campaign, event.target.value as WbRkBlock | "")}
                              className="rounded-md border border-slate-200 px-1.5 py-1 text-xs disabled:opacity-50"
                            >
                              <option value="">Выбрать вид…</option>
                              {WB_RK_BLOCKS.map((block) => (
                                <option key={block} value={block}>{WB_RK_BLOCK_LABELS[block]}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ) : null}

            {visibleItems.length ? (
              <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
                <table className="min-w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500">
                      <th className="sticky left-0 z-10 bg-slate-50 px-2 py-1.5 text-left font-medium">Артикул</th>
                      <th className="px-2 py-1.5 text-left font-medium">Вид</th>
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
                      return (
                        <tr key={`${item.nm}-${item.block}`} className="hover:bg-slate-50/60">
                          <td className="sticky left-0 z-10 bg-white px-2 py-1 hover:bg-slate-50/60">
                            <div className="font-medium tabular-nums text-slate-800">{item.nm}</div>
                            {name ? <div className="max-w-[220px] truncate text-[11px] text-slate-500">{name}</div> : null}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1 text-slate-500">
                            {item.block === WB_RK_BLOCK_UNKNOWN ? WB_RK_BLOCK_UNKNOWN_LABEL : WB_RK_BLOCK_LABELS[item.block as WbRkBlock]}
                          </td>
                          {dates.map((date) => {
                            const cell = item.days[date];
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
                                <td className="border-l border-slate-200 px-2 py-1 text-right tabular-nums text-slate-600">
                                  {cell.bid == null ? "—" : money2(cell.bid)}
                                </td>
                                <td className="px-2 py-1 text-right tabular-nums text-slate-700">{count(cell.carts)}</td>
                                <td className="px-2 py-1 text-right tabular-nums text-slate-700">{count(cell.orders)}</td>
                                <td className="px-2 py-1 text-right tabular-nums text-slate-700">{money(cell.spent)}</td>
                                <ToneCell value={cpo} tone={cpoTone(cpo)} fraction />
                                <ToneCell value={cpl} tone={cplTone(cpl)} fraction />
                              </Fragment>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 font-semibold text-slate-800">
                      <td className="sticky left-0 z-10 bg-slate-50 px-2 py-1.5">Итого</td>
                      <td className="px-2 py-1.5 text-slate-500">{visibleItems.length} строк</td>
                      <td colSpan={Math.max(dates.length * 6, 1)} className="border-l border-slate-200 px-2 py-1.5 text-right tabular-nums">
                        затраты {money(totals.spent)} ₽ · корзин {count(totals.carts)} · заказов {count(totals.orders)} ·
                        <span className={`ml-1 rounded px-1 ${cpoTone(totals.cpo) ? WB_RK_TONE_CLASS[cpoTone(totals.cpo)!] : ""}`}>CPO {money2(totals.cpo)}</span>
                        <span className={`ml-1 rounded px-1 ${cplTone(totals.cpl) ? WB_RK_TONE_CLASS[cplTone(totals.cpl)!] : ""}`}>CPL {money2(totals.cpl)}</span>
                      </td>
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
