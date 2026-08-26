"use client";

import { Check, ChevronRight, Filter, MousePointerClick, Plus, ClipboardList, Download, Loader2, PlayCircle, RefreshCw } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import { PeriodRangePicker } from "@/components/ui/PeriodRangePicker";
import { moscowToday } from "@/lib/ui/calendarGrid";
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
import { WbProductImage } from "./WbProductImage";
import { sortByCustomSkuOrder } from "@/lib/wb/skuOrder";
import { useCabinetSkuOrder } from "@/lib/wb/useCabinetSkuOrder";
import { nmMatchesTags, setWbTagAssignment, useRnpTags, WbTagFilterChips, WbTagPicker } from "./useRnpTags";
import { displaySkuArticle, displaySkuName, useWbSkuNames } from "./useWbSkuNames";
import { WbRkNotePopup } from "./WbRkNotePopup";
import { rkNoteKey, type RkNote } from "@/lib/wb/rkNotes";
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

// Пресеты как в РНП плюс «5 дней» — окно, в котором владелец читает поведение
// кампаний. Произвольные даты выбираются календарём.
const RANGE_PRESETS = [
  { value: "5d", label: "5 дней" },
  { value: "week", label: "Неделя" },
  { value: "two_weeks", label: "2 недели" },
  { value: "month", label: "Месяц" },
] as const;

function isoShift(days: number): string {
  const base = new Date(`${moscowToday()}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() - days);
  return base.toISOString().slice(0, 10);
}

function rangeForPreset(preset: string): { from: string; to: string } {
  const to = moscowToday();
  if (preset === "week") return { from: isoShift(6), to };
  if (preset === "two_weeks") return { from: isoShift(13), to };
  if (preset === "month") return { from: isoShift(29), to };
  return { from: isoShift(4), to };
}
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

/**
 * Ставка артикула за день — диапазон по его кампаниям.
 *
 * Одной цифры здесь быть не может: у CPC-поиска и CPM-полок ставки разные, и
 * усреднять их бессмысленно — это разные валюты внимания. Показываем границы,
 * а совпадающие ставки схлопываем в одно число.
 */
function bidRange(campaigns: JournalCampaign[], date: string): string {
  const bids = campaigns
    .map((campaign) => campaign.days[date]?.bid)
    .filter((bid): bid is number => bid != null && Number.isFinite(bid));
  if (!bids.length) return "—";
  const min = Math.min(...bids);
  const max = Math.max(...bids);
  return min === max ? money2(min) : `${money2(min)}–${money2(max)}`;
}

export function WbRkJournalPage() {
  const { cabinetId, hasExactCabinet, ready, canWrite } = useWbCabinet();
  const [range, setRange] = useState(() => ({ ...rangeForPreset("5d"), preset: "5d" as string }));
  const [data, setData] = useState<JournalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTagIds, setActiveTagIds] = useState<string[]>([]);
  const [blockFilter, setBlockFilter] = useState<string>("all");

  /**
   * Заметки менеджеру: что сделать с товаром или кампанией в этот день.
   * Хранятся на клетку (артикул × кампания × день); кампания может быть
   * пустой — тогда заметка про товар целиком.
   */
  const [notes, setNotes] = useState<Map<string, RkNote>>(new Map());
  const [showNotes, setShowNotes] = useState(true);
  const [noteEdit, setNoteEdit] = useState<{ nm: number; advertId: number | null; date: string; title: string; subtitle: string } | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [openNms, setOpenNms] = useState<Set<number>>(new Set());
  const elapsed = useElapsedSeconds(loading);

  const { tags, tagIdsByNm, reloadTags } = useRnpTags(hasExactCabinet ? cabinetId : null);
  const skuNames = useWbSkuNames(hasExactCabinet ? cabinetId : null);
  const { orderIndex } = useCabinetSkuOrder(hasExactCabinet ? cabinetId : null);

  const load = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to });
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
  }, [cabinetId, range.from, range.to, ready]);

  useEffect(() => { void load(); }, [load]);

  // Заметки грузим окном сразу: значки должны стоять с первого показа, а не
  // появляться по клику.
  useEffect(() => {
    if (!hasExactCabinet || !cabinetId) { setNotes(new Map()); return; }
    const controller = new AbortController();
    fetch(`/api/wb/rk-notes?cabinet=${encodeURIComponent(cabinetId)}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : { notes: [] })
      .then((body) => {
        if (controller.signal.aborted) return;
        setNotes(new Map((body.notes ?? []).map((row: RkNote) => [rkNoteKey(row.nmId, row.advertId, row.date), row])));
      })
      // Заметки — надстройка: без них журнал работает как раньше.
      .catch(() => {});
    return () => controller.abort();
  }, [cabinetId, hasExactCabinet]);

  const applyNote = useCallback((nm: number, advertId: number | null, date: string, note: string, done: boolean) => {
    setNotes((prev) => {
      const next = new Map(prev);
      const key = rkNoteKey(nm, advertId, date);
      if (note) next.set(key, { nmId: nm, advertId, date, note, done, updatedAt: new Date().toISOString() });
      else next.delete(key);
      return next;
    });
  }, []);

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
    // Выбранный вид размещения — это ПУЛ, а не подсветка: внутри артикула
    // остаются только его кампании, и итог по дню пересчитывается по ним.
    // Раньше фильтр оставлял артикул целиком, и при выборе «CPC поиск» строка
    // всё равно показывала сумму вместе с CPM — цифра не отвечала фильтру.
    const byBlock = blockFilter === "all"
      ? items
      : items
        .map((item) => {
          const campaigns = item.campaigns.filter((campaign) => campaign.block === blockFilter);
          if (!campaigns.length) return null;
          const days: Record<string, DayCell> = {};
          for (const campaign of campaigns) {
            for (const [date, cell] of Object.entries(campaign.days)) {
              const acc = days[date] ?? { views: 0, clicks: 0, spent: 0, spentAllocated: 0, carts: 0, orders: 0, ordersSum: 0, snapshot: false };
              acc.views += cell.views;
              acc.clicks += cell.clicks;
              acc.spent += cell.spent;
              acc.spentAllocated += cell.spentAllocated;
              acc.carts += cell.carts;
              acc.orders += cell.orders;
              acc.ordersSum += cell.ordersSum;
              // Снимок у дня общий: если хоть одна кампания из снимка, день снят.
              acc.snapshot = acc.snapshot || cell.snapshot;
              days[date] = acc;
            }
          }
          return { ...item, campaigns, days };
        })
        .filter((item): item is JournalItem => item !== null);
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
    const header = ["Артикул", "Номер WB", "Название", "Кампания", "Вид размещения", ...dates.flatMap((date) => [
      `${dayLabel(date)} ставка`, `${dayLabel(date)} корзин`, `${dayLabel(date)} заказов`,
      `${dayLabel(date)} затраты`, `${dayLabel(date)} CPO`, `${dayLabel(date)} CPL`,
    ])];
    const num = (value: number | null) => value == null ? "" : String(Math.round(value * 100) / 100);

    const rows = visibleItems.flatMap((item) => {
      const name = displaySkuName("", null, skuNames, item.nm);
      // Колонка «Артикул» раньше содержала номер WB — в выгрузке это сбивало
      // с толку так же, как на экране. Теперь их две, как и в таблице.
      const article = displaySkuArticle(null, skuNames, item.nm);
      return item.campaigns.map((campaign) => [
        article,
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
            <PeriodRangePicker
              from={range.from}
              to={range.to}
              presets={RANGE_PRESETS}
              activePreset={range.preset}
              // Кнопка стоит у правого края шапки: раскрытие влево, иначе
              // второй месяц и кнопка «Выбрать» уезжают за экран.
              align="right"
              onApplyPreset={(value) => setRange({ ...rangeForPreset(value), preset: value })}
              onApplyRange={(from, to) => setRange({ from, to, preset: "custom" })}
            />
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

      {noteEdit && cabinetId ? (
        <WbRkNotePopup
          cabinetId={cabinetId}
          nmId={noteEdit.nm}
          advertId={noteEdit.advertId}
          date={noteEdit.date}
          title={noteEdit.title}
          subtitle={noteEdit.subtitle}
          initialNote={notes.get(rkNoteKey(noteEdit.nm, noteEdit.advertId, noteEdit.date))?.note ?? ""}
          initialDone={notes.get(rkNoteKey(noteEdit.nm, noteEdit.advertId, noteEdit.date))?.done ?? false}
          canWrite={canWrite && hasExactCabinet}
          onClose={() => setNoteEdit(null)}
          onSaved={applyNote}
        />
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto px-3 py-3 sm:px-6">
        {error ? <WbErrorState message={error} onRetry={() => void load()} /> : null}
        {data?.notes?.length ? (
          <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            Часть данных не прочиталась, цифры ниже неполные: {data.notes.join("; ")}
          </div>
        ) : null}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {/* Карточки видов размещения выглядели как сводка. Тихая серая строка
              подсказки терялась, поэтому она стала заметным блоком с иконкой —
              её задача не украшать, а объяснить, что по карточкам можно кликать. */}
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-[12px] font-medium text-violet-800">
            <MousePointerClick className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Нажмите на карточку вида размещения — в таблице останутся только его кампании
          </span>
          {blockFilter !== "all" ? (
            <button
              type="button"
              onClick={() => setBlockFilter("all")}
              className="inline-flex items-center gap-1 rounded-full border border-violet-300 bg-white px-2.5 py-1 text-[12px] font-semibold text-violet-700 hover:bg-violet-50"
            >
              Показаны только «{WB_RK_BLOCK_LABELS[blockFilter as WbRkBlock] ?? blockFilter}» · сбросить ✕
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setShowNotes((value) => !value)}
            aria-pressed={showNotes}
            className={`ml-auto rounded-lg border px-2.5 py-1 text-[12px] font-semibold ${showNotes ? "border-violet-300 bg-violet-50 text-violet-700" : "border-slate-200 text-slate-500 hover:border-slate-300"}`}
          >
            {showNotes ? "Задачи показаны" : "Показать задачи"}
          </button>
        </div>
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
                  className={`group/card relative cursor-pointer rounded-xl border p-2.5 text-left transition hover:-translate-y-0.5 hover:shadow-md ${blockFilter === summary.block ? "border-violet-500 bg-violet-50/40 shadow-sm ring-1 ring-violet-200" : "border-slate-200 bg-white hover:border-violet-300"}`}
                >
                  {/* Иконка фильтра проявляется под курсором: карточка сама
                      сообщает, что она не просто сводка. */}
                  <Filter className={`absolute right-2 top-2 h-3 w-3 transition-opacity ${blockFilter === summary.block ? "text-violet-600 opacity-100" : "text-violet-400 opacity-0 group-hover/card:opacity-100"}`} aria-hidden="true" />
                  <div className={`truncate pr-4 text-[11px] font-semibold uppercase tracking-wide ${blockFilter === summary.block ? "text-violet-700" : "text-slate-500"}`}>{summary.label}</div>
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

            {/* Ярлыки показываем даже пустыми: их вешают тут же, в строке
                артикула, и панель, которая появляется только после первого
                назначения, выглядит как отсутствующая функция. */}
            <div className="mb-3">
              {tags.length ? (
                <WbTagFilterChips
                  tags={tags}
                  activeIds={activeTagIds}
                  counts={tagCounts}
                  showEmpty
                  onToggle={(id) => setActiveTagIds((prev) => prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id])}
                  onClear={() => setActiveTagIds([])}
                />
              ) : hasExactCabinet ? (
                <p className="text-[10px] text-slate-400">
                  Ярлыков в кабинете нет — создайте их в РНП, а вешать на артикулы можно прямо здесь, кнопкой «+ ярлык».
                </p>
              ) : null}
            </div>

            {visibleItems.length ? (
              <div className="max-h-[calc(100vh-320px)] overflow-auto rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                <table className="min-w-full border-collapse text-xs">
                  {/* Шапка липнет к верху контейнера, первая колонка — к левому
                      краю: на 30 днях таблица уезжает в обе стороны, и без
                      этого не понять, какой день и чей артикул перед глазами. */}
                  <thead className="sticky top-0 z-30">
                    <tr className="bg-slate-50 text-slate-500 shadow-[0_1px_0_rgba(226,232,240,1)]">
                      <th className="sticky left-0 z-40 bg-slate-50 px-3 py-2 text-left font-semibold">Артикул</th>
                      <th className="bg-slate-50 px-2 py-2 text-left font-medium">Кампании</th>
                      {dates.map((date) => (
                        <th key={date} colSpan={7} className="border-l border-slate-200 bg-slate-50 px-2 py-2 text-center font-semibold text-slate-700">
                          {dayLabel(date)}
                          {data.snapshotDates.includes(date)
                            ? <span className="ml-1 font-normal text-emerald-600" title="День снят в 06:00 МСК: ставка зафиксирована">снят</span>
                            : <span className="ml-1 font-normal text-slate-400" title="День ещё не снят: считается на лету">live</span>}
                        </th>
                      ))}
                    </tr>
                    <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400 shadow-[0_1px_0_rgba(226,232,240,1)]">
                      <th className="sticky left-0 z-40 bg-slate-50 px-3 pb-2" />
                      <th className="bg-slate-50 px-2 pb-2" />
                      {dates.map((date) => (
                        <Fragment key={date}>
                          <th className="border-l border-slate-200 bg-slate-50 px-2 pb-2 text-right font-normal">Ставка</th>
                          <th className="bg-slate-50 px-2 pb-2 text-right font-normal">Корзин</th>
                          <th className="bg-slate-50 px-2 pb-2 text-right font-normal">Заказов</th>
                          <th className="bg-slate-50 px-2 pb-2 text-right font-normal">Затраты</th>
                          <th className="bg-slate-50 px-2 pb-2 text-right font-normal">CPO</th>
                          <th className="bg-slate-50 px-2 pb-2 text-right font-normal">CPL</th>
                          <th className="bg-slate-50 px-2 pb-2 text-center font-normal">Задача</th>
                        </Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleItems.map((item) => {
                      const name = displaySkuName("", null, skuNames, item.nm);
                      // Тот же вид, что в Полках и Воронке: артикул склада,
                      // номер WB, название карточки. Раньше здесь был только
                      // номер — по нему товар не опознать без кабинета WB.
                      const article = displaySkuArticle(null, skuNames, item.nm);
                      const open = openNms.has(item.nm);
                      const shown = blockFilter === "all"
                        ? item.campaigns
                        : item.campaigns.filter((campaign) => campaign.block === blockFilter || campaign.block === WB_RK_BLOCK_ATTRIBUTED);
                      return (
                        <Fragment key={item.nm}>
                          <tr
                            className={`group/row cursor-pointer font-medium transition-colors ${open ? "bg-violet-50/50" : "bg-white hover:bg-violet-50/25"}`}
                            onClick={() => setOpenNms((prev) => {
                              const next = new Set(prev);
                              if (next.has(item.nm)) next.delete(item.nm); else next.add(item.nm);
                              return next;
                            })}
                          >
                            {/* Фон закреплённой колонки только сплошной: под ней проезжают колонки
                                дней, и через полупрозрачный фон их цифры просвечивали прямо
                                поверх артикула — выглядело как наложение строк. */}
                            <td className={`sticky left-0 z-20 px-3 py-2 ${open ? "bg-violet-100" : "bg-white group-hover/row:bg-violet-50"}`}>
                              <div className="flex items-center gap-2.5">
                                <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`} />
                                {/* Картинка WB лежит на одном из нескольких «баскетов», и по
                                    номеру он только угадывается. Одна ссылка промахивалась —
                                    у части артикулов вместо фото была заглушка. Компонент
                                    перебирает варианты, как в Воронке и Полках. */}
                                <WbProductImage
                                  nm={item.nm}
                                  label={article}
                                  className="h-11 w-9 shrink-0 rounded-md bg-slate-100 object-cover ring-1 ring-slate-200/60"
                                />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="max-w-[190px] truncate text-[13px] font-bold tracking-[-0.01em] text-slate-800">{article || `WB ${item.nm}`}</span>
                                    {canWrite && hasExactCabinet ? (
                                      <WbTagPicker
                                        tags={tags}
                                        assignedIds={tagIdsByNm.get(item.nm) ?? []}
                                        onToggle={async (tagId, assigned) => {
                                          if (!cabinetId) return false;
                                          const ok = await setWbTagAssignment(cabinetId, item.nm, tagId, assigned);
                                          if (ok) reloadTags();
                                          return ok;
                                        }}
                                      />
                                    ) : null}
                                  </div>
                                  <div className="max-w-[210px] truncate text-[11px] font-normal tabular-nums text-slate-400">WB {item.nm}</div>
                                  {name ? <div className="max-w-[210px] truncate text-[11px] font-normal text-slate-500">{name}</div> : null}
                                </div>
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-[11px] font-normal text-slate-500">
                              {shown.length} {shown.length === 1 ? "кампания" : shown.length < 5 ? "кампании" : "кампаний"}
                            </td>
                            {dates.map((date) => {
                              const cell = item.days[date];
                              const note = notes.get(rkNoteKey(item.nm, null, date));
                              const noteBadge = showNotes ? (
                                <button
                                  type="button"
                                  onClick={(event) => { event.stopPropagation(); setNoteEdit({ nm: item.nm, advertId: null, date, title: article || `WB ${item.nm}`, subtitle: "Задача по товару" }); }}
                                  title={note ? `${note.done ? "Сделано: " : ""}${note.note}` : "Добавить задачу на этот день"}
                                  aria-label={note ? "Открыть задачу" : "Добавить задачу"}
                                  className={`inline-grid h-5 w-5 place-items-center rounded-full border transition-colors ${
                                    note
                                      ? note.done
                                        ? "border-emerald-200 bg-emerald-50 text-emerald-600"
                                        : "border-violet-200 bg-violet-100 text-violet-700"
                                      : "border-dashed border-slate-200 text-slate-300 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-600"
                                  }`}
                                >{note ? (note.done ? <Check className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />) : <Plus className="h-3 w-3" />}</button>
                              ) : null;
                              if (isEmpty(cell)) {
                                return (
                                  <Fragment key={date}>
                                    {/* Прочерк объединяет только колонки метрик: раньше он
                                        захватывал и «Задачу», и кнопка оказывалась посреди дня. */}
                                    <td colSpan={6} className="border-l border-slate-200 px-2 py-1.5 text-center font-normal text-slate-300">—</td>
                                    <td className="px-1 py-1.5 text-center">{noteBadge}</td>
                                  </Fragment>
                                );
                              }
                              const cpo = costPerOrder(cell.spent, cell.orders);
                              const cpl = costPerCart(cell.spent, cell.carts);
                              return (
                                <Fragment key={date}>
                                  {/* Ставка у артикула — диапазон по его кампаниям: одна цифра
                                      здесь была бы выдумкой, ставки у кампаний разные. Колонка
                                      пустовала, и это выглядело поломкой. */}
                                  <td className="border-l border-slate-200 px-2 py-1.5 text-right tabular-nums text-slate-500">{bidRange(shown, date)}</td>
                                  <td className="px-2 py-1.5 text-right tabular-nums">{count(cell.carts)}</td>
                                  <td className="px-2 py-1.5 text-right tabular-nums">{count(cell.orders)}</td>
                                  <td className="px-2 py-1.5 text-right tabular-nums">{money(cell.spent)}</td>
                                  <ToneCell value={cpo} tone={cpoTone(cpo)} fraction />
                                  <ToneCell value={cpl} tone={cplTone(cpl)} fraction />
                                  <td className="px-1 py-1.5 text-center">{noteBadge}</td>
                                </Fragment>
                              );
                            })}
                          </tr>
                          {open ? shown.map((campaign) => (
                            <tr key={`${item.nm}-${campaign.advertId ?? campaign.block}`} className="bg-slate-50/60 text-slate-600 transition-colors hover:bg-violet-50/30">
                              <td className="sticky left-0 z-20 bg-slate-50 py-1.5 pl-[68px] pr-3">
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
                                // Заметка по кампании: «поднять ставку» относится к ней,
                                // а не к товару целиком — уровни разные.
                                const cNote = campaign.advertId == null ? undefined : notes.get(rkNoteKey(item.nm, campaign.advertId, date));
                                const cBadge = showNotes && campaign.advertId != null ? (
                                  <button
                                    type="button"
                                    onClick={(event) => { event.stopPropagation(); setNoteEdit({ nm: item.nm, advertId: campaign.advertId, date, title: campaign.name ?? `Кампания ${campaign.advertId}`, subtitle: article || `WB ${item.nm}` }); }}
                                    title={cNote ? `${cNote.done ? "Сделано: " : ""}${cNote.note}` : "Добавить задачу по кампании"}
                                    aria-label={cNote ? "Открыть задачу" : "Добавить задачу"}
                                    className={`inline-grid h-5 w-5 place-items-center rounded-full border transition-colors ${
                                      cNote
                                        ? cNote.done
                                          ? "border-emerald-200 bg-emerald-50 text-emerald-600"
                                          : "border-violet-200 bg-violet-100 text-violet-700"
                                        : "border-dashed border-slate-200 text-slate-300 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-600"
                                    }`}
                                  >{cNote ? (cNote.done ? <Check className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />) : <Plus className="h-3 w-3" />}</button>
                                ) : null;
                                if (isEmpty(cell)) {
                                  return (
                                    <Fragment key={date}>
                                      <td colSpan={6} className="border-l border-slate-200 px-2 py-1 text-center text-slate-300">—</td>
                                      <td className="px-1 py-1 text-center">{cBadge}</td>
                                    </Fragment>
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
                                    <td className="px-1 py-1 text-center">{cBadge}</td>
                                  </Fragment>
                                );
                              })}
                            </tr>
                          )) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot className="sticky bottom-0 z-30">
                    <tr className="bg-slate-100 font-semibold text-slate-800 shadow-[0_-1px_0_rgba(226,232,240,1)]">
                      <td className="sticky left-0 z-40 bg-slate-100 px-3 py-2">Итого</td>
                      <td className="bg-slate-100 px-2 py-2 font-normal text-slate-500">{visibleItems.length} артикулов</td>
                      {dates.map((date) => {
                        const total = dayTotals.get(date);
                        if (!total || (!total.spent && !total.carts && !total.orders)) {
                          return <td key={date} colSpan={7} className="border-l border-slate-200 bg-slate-100 px-2 py-2 text-center font-normal text-slate-300">—</td>;
                        }
                        const cpo = costPerOrder(total.spent, total.orders);
                        const cpl = costPerCart(total.spent, total.carts);
                        return (
                          <Fragment key={date}>
                            <td className="border-l border-slate-200 bg-slate-100 px-2 py-2" />
                            <td className="bg-slate-100 px-2 py-2 text-right tabular-nums">{count(total.carts)}</td>
                            <td className="bg-slate-100 px-2 py-2 text-right tabular-nums">{count(total.orders)}</td>
                            <td className="bg-slate-100 px-2 py-2 text-right tabular-nums">{money(total.spent)}</td>
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
