"use client";

import { ArrowUpNarrowWide, ChevronDown, ChevronRight, CopyPlus, Rows3, Filter, MousePointerClick, Plus, ClipboardList, Download, Loader2, PlayCircle, RefreshCw } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent, useRef } from "react";
import { Hint } from "@/components/ui/Hint";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import { PeriodRangePicker } from "@/components/ui/PeriodRangePicker";
import { moscowToday } from "@/lib/ui/calendarGrid";
import {
  blockMatchesFilter,
  bothBlockFor,
  WB_RK_BLOCKS,
  WB_RK_BLOCK_ATTRIBUTED,
  WB_RK_BLOCK_ATTRIBUTED_LABEL,
  WB_RK_BLOCK_LABELS,
  WB_RK_BLOCK_UNKNOWN,
  WB_RK_BLOCK_UNKNOWN_LABEL,
  type WbRkBlock,
} from "@/lib/wb/advertBlocks";
import { costPerCart, costPerOrder, cplTone, cpoTone, WB_RK_SOFT_TONE, WB_RK_TONE_CLASS } from "@/lib/wb/rkThresholds";
import { WbProductImage } from "./WbProductImage";
import { sortByCustomSkuOrder } from "@/lib/wb/skuOrder";
import { useCabinetSkuOrder } from "@/lib/wb/useCabinetSkuOrder";
import { nmMatchesTags, setWbTagAssignment, useRnpTags, WbTagFilterChips, WbTagPicker } from "./useRnpTags";
import { displaySkuArticle, displaySkuName, useWbSkuNames } from "./useWbSkuNames";
import { WbRkNoteQuickPick } from "./WbRkNoteQuickPick";
import { WbRkNotePopup } from "./WbRkNotePopup";
import { rkNoteKey, rkNoteShort, rkNoteTone, type RkNote } from "@/lib/wb/rkNotes";
import { CTR_MIN_CAMPAIGN_SPEND } from "@/lib/wb/ctrCampaignPick";
import { canRunSyncManually } from "@/lib/sync/manualRunRoles";
import { useWbCabinet } from "./WbCabinetContext";
import { WbEmptyState, WbErrorState, WbModuleHeader } from "./WbModuleHeader";

interface DayCell {
  bid: number | null;
  /** Ставка полок у видов «поиск + полки»: WB держит две, колонка одна. */
  bidAlt?: number | null;
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
  /** Вид, на котором кампания сожгла больше всего денег в окне. */
  block: string;
  /** Вид по дням — приходит, только если внутри окна он менялся. */
  blocks?: Record<string, string>;
  /** Сколько артикулов ведёт кампания: её имя бывает от соседнего товара. */
  nmCount: number | null;
  days: Record<string, DayCell>;
}

/**
 * Вид размещения кампании в конкретный день. WB разрешает включать и выключать
 * площадки на живую, поэтому один ярлык на всё окно врёт: кампания, стоявшая в
 * понедельник на полках, а во вторник ещё и в поиске, обязана попасть в обе
 * карточки.
 */
const campaignBlockAt = (campaign: JournalCampaign, date: string) => campaign.blocks?.[date] ?? campaign.block;

/**
 * Подпись вида размещения для строки кампании и для выгрузки.
 *
 * Считается по дням, которые в строке реально остались: под фильтром это ровно
 * один вид, без фильтра — вся история переключений («поиск → полки → поиск +
 * полки»). Один ярлык на всю строку врал ровно там, где правка и делалась:
 * полочный день кампании, у которой сегодня включены обе площадки,
 * подписывался «CPC поиск + полки» — под фильтром «CPC полки».
 */
function campaignBlockLabel(campaign: JournalCampaign): string {
  if (campaign.block === WB_RK_BLOCK_ATTRIBUTED) return "";
  const name = (block: string) => block === WB_RK_BLOCK_UNKNOWN
    ? WB_RK_BLOCK_UNKNOWN_LABEL
    : WB_RK_BLOCK_LABELS[block as WbRkBlock] ?? block;
  const sequence: string[] = [];
  for (const date of Object.keys(campaign.days).sort()) {
    const block = campaignBlockAt(campaign, date);
    if (sequence[sequence.length - 1] !== block) sequence.push(block);
  }
  return sequence.length ? sequence.map(name).join(" → ") : name(campaign.block);
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
  /** Дни, где снимок есть, но неполон: метрики из слоя, ставки из снимка. */
  partialDates?: string[];
  /**
   * Виды размещения, которые есть у кабинета в справочнике WB.
   * null — справочник не прочитался: утверждать, что вида нет, нельзя.
   */
  blocksInCabinet?: string[] | null;
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

function ToneCell({ value, tone, fraction, edge }: { value: number | null; tone: string | null; fraction?: boolean; edge?: boolean }) {
  const text = value == null ? "—" : fraction ? money2(value) : money(value);
  return (
    <td className={`min-w-[70px] whitespace-nowrap py-1 text-right tabular-nums ${edge ? "pl-2 pr-3" : "px-2"} ${tone ? WB_RK_SOFT_TONE[tone as "green"] : "text-slate-700"}`}>
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
  const short = (bid: number) => (Number.isInteger(bid) ? money(bid) : money2(bid));
  return min === max ? short(min) : `${short(min)}–${short(max)}`;
}

/**
 * Подсказка над клеткой задачи.
 *
 * У предложения алгоритма показываем ПРИЧИНУ: совет без основания человек
 * принимает вслепую или отвергает не глядя, и в обоих случаях сверять потом
 * нечего. У переписанного совета показываем ещё и что предлагалось — это
 * ровно то место, где видно расхождение.
 */
function noteTitle(entry: RkNote): string {
  const parts: string[] = [];
  if (entry.done) parts.push("Сделано:");
  parts.push(entry.note);
  if (entry.source === "auto" && entry.suggestedReason) {
    parts.push(`\n\nПредложил алгоритм: ${entry.suggestedReason}`);
  }
  if (entry.source === "human" && entry.suggestedNote && entry.suggestedNote !== entry.note) {
    parts.push(`\n\nАлгоритм предлагал: ${entry.suggestedNote}`);
    if (entry.suggestedReason) parts.push(`(${entry.suggestedReason})`);
  }
  return parts.join(" ");
}

export function WbRkJournalPage() {
  const { cabinetId, hasExactCabinet, ready, canWrite, user } = useWbCabinet();
  // canWrite — право ОПИСЫВАТЬ (задачи, заметки): оно есть и у менеджера, и у
  // селлера с уровнем. Прогон синхронизации гейтится не им, а ролью — тем же
  // списком, что и на сервере (checkCronAuth). Пока кнопка висела на canWrite,
  // она была активна у тех, кому роут отвечает 401.
  const canRunSync = canRunSyncManually(user?.role);
  const [range, setRange] = useState(() => ({ ...rangeForPreset("5d"), preset: "5d" as string }));
  const [data, setData] = useState<JournalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTagIds, setActiveTagIds] = useState<string[]>([]);
  const [blockFilter, setBlockFilter] = useState<string>("all");
  /**
   * Включать ли в фильтр кампании «поиск + полки».
   *
   * WB отдаёт у такой кампании обе площадки, а расход между ними не делит,
   * поэтому она живёт отдельной карточкой — приписать её деньги к полкам
   * значило бы сложить чужие рубли в чужой блок. Но человек, выбравший
   * «CPC полки», ищет кампании, которые крутятся НА ПОЛКАХ, и не находил их:
   * кампания «ОТГРУЗКА CPC 1099(150)/бирюзовая» стоит на обеих площадках и в
   * список не попадала. Переключатель отвечает на его вопрос, не трогая
   * деньги в карточках: они считаются до фильтра и остаются раздельными.
   */
  const [withBoth, setWithBoth] = useState(false);
  /** Наверх — артикулы, по которым в последний день реклама работала. */
  const [workingFirst, setWorkingFirst] = useState(false);

  /**
   * Заметки менеджеру: что сделать с товаром или кампанией в этот день.
   * Хранятся на клетку (артикул × кампания × день); кампания может быть
   * пустой — тогда заметка про товар целиком.
   */
  const [notes, setNotes] = useState<Map<string, RkNote>>(new Map());
  const [showNotes, setShowNotes] = useState(true);
  /**
   * Развёрнуты ли карточки видов размещения.
   *
   * Семь карточек с восемью строками каждая занимают 230 пикселей, а вместе с
   * подсказкой, предупреждением и шапкой таблица начиналась на 510-м пикселе:
   * при окне в 1000 пикселей видно четыре строки из двух с половиной сотен.
   * Экраном работают каждый день и смотрят в него таблицу, а не сводку.
   *
   * Свёрнутые карточки остаются рабочими: та же сумма, тот же клик-фильтр,
   * одна строка вместо четырёх рядов.
   */
  const [cardsOpen, setCardsOpen] = useState(true);
  /**
   * Плотные строки.
   *
   * Строка артикула — 87 пикселей: фото, артикул, номер WB и название товара в
   * четыре яруса. На экране в 1000 пикселей это семь строк из двух с половиной
   * сотен. В плотном режиме остаются артикул и номер — по ним товар и
   * опознают, — фото уменьшается, название уходит в подсказку.
   */
  const [dense, setDense] = useState(false);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("wb-rk-dense");
      if (saved != null) setDense(saved === "1");
    } catch { /* приватное окно — остаёмся на умолчании */ }
  }, []);
  const toggleDense = () => setDense((value) => {
    const next = !value;
    try { window.localStorage.setItem("wb-rk-dense", next ? "1" : "0"); } catch { /* не беда */ }
    return next;
  });
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("wb-rk-cards-open");
      if (saved != null) setCardsOpen(saved === "1");
    } catch { /* приватное окно — остаёмся на умолчании */ }
  }, []);
  const toggleCards = () => setCardsOpen((open) => {
    const next = !open;
    try { window.localStorage.setItem("wb-rk-cards-open", next ? "1" : "0"); } catch { /* не беда */ }
    return next;
  });
  const [noteEdit, setNoteEdit] = useState<{ nm: number; advertId: number | null; date: string; title: string; subtitle: string } | null>(null);
  // Быстрый выбор задачи открывается у самой клетки, поэтому носит с собой
  // координаты клика: список повторяющихся задач должен появляться там, где
  // человек уже смотрит, а не в центре экрана.
  // Липкий столбец артикула поднимается над таблицей только когда её увели
  // вправо. Иначе тень висела бы на месте, где ничего не перекрывается.
  const [scrolledAside, setScrolledAside] = useState(false);
  const [notePick, setNotePick] = useState<
    { nm: number; advertId: number | null; date: string; title: string; subtitle: string; x: number; y: number } | null
  >(null);
  /**
   * Выключенные задачи убирают КОЛОНКУ, а не только значки в ней. Пустой
   * столбец без содержимого всё равно ест ширину и сбивает чтение таблицы,
   * ради которого его и выключают.
   */
  const dayCols = showNotes ? 7 : 6;
  /** Общий тон колонки задач: она служебная и не должна теряться среди цифр. */
  // Столбец задач идёт сплошной полосой через всю таблицу: он не про цифры дня,
  // а про то, что человек с этим днём собирается делать. Заливка обязана быть
  // на КАЖДОЙ его ячейке — иначе полоса рвётся везде, где у дня есть цифры, то
  // есть почти везде, и столбец перестаёт читаться как столбец.
  const TASK_CELL = "bg-violet-50/40 border-l border-slate-200";
  // Ширина столбца задач задана жёстко. Иначе её определяла самая длинная
  // задача дня — «Работа с 17:00 - 24:00 + ЕРК» раздвигала колонку, «Откл»
  // сжимала, и сетка гуляла от дня ко дню, утаскивая за собой соседний CPL.
  /**
   * Ширина столбца задачи.
   *
   * Было 92px под чип в 80px с обрезкой: «Круглосуточно (ЕРК запущена)»
   * превращалось в «24 ч · ЕРК», а своя формулировка — в многоточие. Чтобы
   * прочитать назначенное, менеджеру приходилось открывать клетку и жать
   * «Изменить текст». В рабочей таблице владельца та же колонка показывает
   * строку целиком, и люди читают лист глазами, а не кликами.
   */
  const TASK_COL = "w-[150px] min-w-[150px]";
  // Правый край липкого столбца. Без него уезжающий под столбец текст
  // обрывается посреди слова и числа: «СТАВКА» превращается в «ВКА», «333,00»
  // в «3,00» — и это читается как поломка вёрстки, а не как слой поверх
  // таблицы. Тень объясняет обрыв: колонка лежит выше, содержимое уходит под неё.
  const STICKY_EDGE = scrolledAside
    ? "border-r border-slate-200 shadow-[8px_0_10px_-8px_rgba(15,23,42,0.22)]"
    : "border-r border-transparent";
  // Цвет задачи — её смысл, а не украшение: выключено, круглосуточно, вечерний
  // режим. Сделанная гасится, чтобы взгляд цеплялся за невыполненные.
  const NOTE_TONE: Record<string, string> = {
    off: "bg-rose-100/80 text-rose-700",
    round: "bg-emerald-100/80 text-emerald-700",
    evening: "bg-amber-100/80 text-amber-800",
    // Бюджет — это про деньги, а не про режим работы: свой цвет, чтобы в
    // столбце было видно, где сегодня меняли сумму, а где расписание.
    budget: "bg-sky-100/80 text-sky-800",
    custom: "bg-violet-100 text-violet-700",
  };

  /**
   * Клетка задачи. Раньше здесь стояла точка, а текст жил в подсказке — чтобы
   * узнать, что назначено, приходилось наводить курсор на каждую клетку по
   * очереди. Теперь задача читается прямо на листе.
   */
  const noteChip = (
    entry: RkNote | undefined,
    open: (event: ReactMouseEvent<HTMLButtonElement>) => void,
    emptyHint: string,
  ) => (
    <button
      type="button"
      onClick={open}
      title={entry ? noteTitle(entry) : emptyHint}
      aria-label={entry ? `${entry.source === "auto" ? "Предложение алгоритма" : "Задача"}: ${entry.note}` : emptyHint}
      // Главная операция экрана — поставить задачу на день. Клетка высотой в
      // 22px пальцем не берётся, а соседние клетки дней стоят вплотную: до sm
      // растягиваем цель до 44px, на мыши плотность остаётся прежней.
      className={`inline-flex min-h-11 items-center justify-center gap-1 rounded-full py-[3px] text-[11px] font-semibold leading-4 transition-colors sm:min-h-0 sm:text-[10px] ${
        entry
          // Предложение алгоритма и решение человека не должны выглядеть
          // одинаково: иначе непонятно, что уже решено, а с чем можно спорить.
          // Совет — пунктиром и приглушённо, решение — заливкой.
          ? entry.source === "auto"
            ? `w-[138px] rounded-lg border border-dashed border-violet-300 bg-violet-50/60 px-2 text-violet-700${entry.done ? " opacity-60" : ""}`
            : `w-[138px] rounded-lg px-2 ${NOTE_TONE[rkNoteTone(entry.note)]}${entry.done ? " opacity-60" : ""}`
          : "min-w-11 border border-dashed border-slate-200 px-1 text-slate-300 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-600 sm:min-w-0"
      }`}
    >
      {entry
        // Две строки, а не обрезка: короткая подпись пресета помещалась и
        // раньше, а своя формулировка — нет, и именно её важнее всего прочесть.
        ? <span className={`line-clamp-2 whitespace-normal break-words text-left ${entry.done ? "line-through" : ""}`}>{rkNoteShort(entry.note)}</span>
        : <Plus className="h-3 w-3" />}
    </button>
  );

  /** Клик по клетке: пишущему — список повторяющихся задач, остальным — просмотр. */
  const openNote = (
    event: ReactMouseEvent<HTMLButtonElement>,
    place: { nm: number; advertId: number | null; date: string; title: string; subtitle: string },
  ) => {
    event.stopPropagation();
    if (!canWrite || !hasExactCabinet) { setNoteEdit(place); return; }
    const box = event.currentTarget.getBoundingClientRect();
    setNotePick({ ...place, x: box.left + box.width / 2, y: box.bottom });
  };
  const [syncing, setSyncing] = useState<string | null>(null);
  const [openNms, setOpenNms] = useState<Set<number>>(new Set());
  const elapsed = useElapsedSeconds(loading);

  const { tags, tagIdsByNm, reloadTags } = useRnpTags(hasExactCabinet ? cabinetId : null);
  const skuNames = useWbSkuNames(hasExactCabinet ? cabinetId : null);
  const { orderIndex } = useCabinetSkuOrder(hasExactCabinet ? cabinetId : null);

  // Период и кабинет переключают подряд, а журнал считается долго: без счётчика
  // на экране оставался прежний срез под новой подписью. Приём тот же, что
  // строкой ниже у заметок и в WbFunnelPage.
  const requestId = useRef(0);
  const load = useCallback(async () => {
    if (!ready) return;
    const current = ++requestId.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      if (cabinetId) params.set("cabinet", cabinetId);
      const response = await fetch(`/api/wb/rk-journal?${params}`, { cache: "no-store", signal: controller.signal });
      const body = await response.json().catch(() => ({}));
      if (current !== requestId.current) return;
      if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
      setData(body as JournalData);
    } catch (err) {
      if (current !== requestId.current || controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Не удалось загрузить журнал");
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [cabinetId, range.from, range.to, ready]);

  useEffect(() => { void load(); }, [load]);


  /**
   * Задачи окном.
   *
   * Отдельной функцией, а не только эффектом: «Обновить» обязана перечитывать
   * и их. Раньше кнопка тянула лишь цифры журнала, а журнал — ночной снимок,
   * который за день не меняется. Со стороны это выглядело как «жму, и ничего
   * не происходит»: чужие задачи, поставленные за это время, не появлялись.
   */
  const loadNotes = useCallback(async () => {
    if (!hasExactCabinet || !cabinetId) { setNotes(new Map()); return; }
    try {
      const response = await fetch(`/api/wb/rk-notes?cabinet=${encodeURIComponent(cabinetId)}`, { cache: "no-store" });
      const body = response.ok ? await response.json() : { notes: [] };
      setNotes(new Map((body.notes ?? []).map((row: RkNote) => [rkNoteKey(row.nmId, row.advertId, row.date), row])));
    } catch {
      // Заметки — надстройка: без них журнал работает как раньше.
    }
  }, [cabinetId, hasExactCabinet]);

  useEffect(() => { void loadNotes(); }, [loadNotes]);
  /** Когда последний раз перечитывали. Пусто — ещё ни разу вручную. */
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const refreshAll = useCallback(async () => {
    await Promise.all([load(), loadNotes()]);
    setRefreshedAt(new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }));
  }, [load, loadNotes]);

  /**
   * Перенос вчерашних задач на последний день окна.
   *
   * Менеджер ставит одни и те же задачи изо дня в день, а артикулов полторы
   * сотни: по клетке это полтораста кликов. Сервер заполняет только пустые
   * клетки — уже стоящее решение не затирается ни своё, ни чужое.
   */
  const [copying, setCopying] = useState(false);
  const [copyResult, setCopyResult] = useState<string | null>(null);
  const copyYesterday = useCallback(async () => {
    const list = data?.dates ?? [];
    if (list.length < 2 || !cabinetId) return;
    const to = list[list.length - 1];
    const from = list[list.length - 2];
    setCopying(true);
    setCopyResult(null);
    try {
      const response = await fetch("/api/wb/rk-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cabinetId, copyFrom: from, copyTo: to }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.ok) throw new Error(body?.error || `Ошибка ${response.status}`);
      await loadNotes();
      setCopyResult(body.copied
        ? `Перенесено задач: ${body.copied}${body.skipped ? `, пропущено занятых: ${body.skipped}` : ""}`
        : body.skipped ? `Все ${body.skipped} задач уже стоят на ${dayLabel(to)}` : `За ${dayLabel(from)} задач нет`);
    } catch (cause) {
      setCopyResult(cause instanceof Error ? cause.message : "Не удалось перенести задачи");
    } finally {
      setCopying(false);
    }
  }, [cabinetId, data?.dates, loadNotes]);

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

  // Строки после ярлыков, но ДО фильтра по виду размещения. Сводка карточек
  // считается именно по ним: раньше она стояла на уже отфильтрованных данных,
  // и клик по одной карточке заставлял остальные шесть написать «нет кампаний»,
  // хотя кампании этих видов живы и жгут деньги.
  const taggedItems = useMemo(
    () => (data?.items ?? []).filter((item) => nmMatchesTags(tagIdsByNm, item.nm, activeTagIds)),
    [activeTagIds, data?.items, tagIdsByNm],
  );

  const visibleItems = useMemo(() => {
    // Выбранный вид размещения — это ПУЛ, а не подсветка: внутри артикула
    // остаются только его кампании, и итог по дню пересчитывается по ним.
    // Раньше фильтр оставлял артикул целиком, и при выборе «CPC поиск» строка
    // всё равно показывала сумму вместе с CPM — цифра не отвечала фильтру.
    const byBlock = blockFilter === "all"
      ? taggedItems
      : taggedItems
        .map((item) => {
          // Вид сверяем ПО ДНЯМ: кампания, сменившая площадку внутри окна,
          // попадает в фильтр только теми днями, когда она там и крутилась.
          const campaigns = item.campaigns
            .map((campaign) => {
              const days = Object.fromEntries(
                Object.entries(campaign.days).filter(([date]) => blockMatchesFilter(campaignBlockAt(campaign, date), blockFilter, withBoth)),
              );
              return Object.keys(days).length ? { ...campaign, days } : null;
            })
            .filter((campaign): campaign is JournalCampaign => campaign !== null);
          if (!campaigns.length) return null;
          const days: Record<string, DayCell> = {};
          for (const campaign of campaigns) {
            for (const [date, cell] of Object.entries(campaign.days)) {
              const acc = days[date] ?? { bid: null, views: 0, clicks: 0, spent: 0, spentAllocated: 0, carts: 0, orders: 0, ordersSum: 0, snapshot: false };
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
    const ordered = sortByCustomSkuOrder(byBlock, (item) => item.nm, orderIndex);
    if (!workingFirst) return ordered;
    /**
     * Наверх — артикулы, по которым в последний день реклама реально работала.
     *
     * Порог в рублях, а не в показах: решение владельца. Кампания, потратившая
     * за сутки три рубля, показов могла набрать сколько угодно, но решать по
     * ней нечего — глаз цепляется, а работы нет. Порог общий с воронкой
     * (CTR_MIN_CAMPAIGN_SPEND): «кампания в этот день работала» — один вопрос,
     * и ответ на него должен быть один на всю панель.
     *
     * Остальные не прячутся, а опускаются вниз: спрятанная строка выглядит как
     * потерянный товар, и её начинают искать.
     */
    const lastDay = (data?.dates ?? []).at(-1);
    if (!lastDay) return ordered;
    const spentLastDay = (item: JournalItem) => item.days[lastDay]?.spent ?? 0;
    return [...ordered].sort((left, right) => {
      const leftWorks = spentLastDay(left) >= CTR_MIN_CAMPAIGN_SPEND ? 0 : 1;
      const rightWorks = spentLastDay(right) >= CTR_MIN_CAMPAIGN_SPEND ? 0 : 1;
      return leftWorks - rightWorks;
    });
  }, [blockFilter, data?.dates, orderIndex, taggedItems, withBoth, workingFirst]);

  /** Сколько артикулов реально работали в последний день окна. */
  const workingCount = useMemo(() => {
    const lastDay = (data?.dates ?? []).at(-1);
    if (!lastDay) return null;
    return taggedItems.filter((item) => (item.days[lastDay]?.spent ?? 0) >= CTR_MIN_CAMPAIGN_SPEND).length;
  }, [data?.dates, taggedItems]);

  /*
   * Счётчика «Предложений алгоритма» здесь больше нет.
   *
   * Он отвечал на вопрос «где посмотреть, что заполнил ИИ», пока предложения
   * были редкими советами про ставку. Теперь ночной прогон переносит вчерашние
   * решения, и предложением помечена почти каждая клетка: число в шапке стало
   * счётчиком строк в таблице, а не подсказкой. Найти совет по-прежнему легко —
   * они нарисованы пунктиром, в отличие от решений человека.
   */

  /** Парный вид «обе площадки» для выбранного. null — такого не бывает. */
  const pairedBlock = blockFilter !== "all" && WB_RK_BLOCKS.includes(blockFilter as WbRkBlock)
    ? bothBlockFor(blockFilter as WbRkBlock)
    : null;

  // Виды, которые есть у кабинета в справочнике WB. null — справочник не
  // прочитался: «таких кампаний нет» тогда не факт, а домысел.
  const knownBlocks = data?.blocksInCabinet ?? null;

  // Сводка по видам размещения: числитель и знаменатель складываются отдельно,
  // среднее из процентов по строкам дало бы неверный CPO/CPL.
  const blockSummary = useMemo(() => {
    const acc = new Map<string, { spent: number; allocated: number; carts: number; orders: number; clicks: number; views: number; ordersSum: number; skus: Set<number> }>();
    for (const item of taggedItems) {
      for (const campaign of item.campaigns) {
        // Конверсии из чужих кампаний вида размещения не имеют: попав в блок,
        // они бы улучшили его CPO заказами, которых он не покупал. Сколько их —
        // считаем отдельно и говорим вслух: молча делить расход на урезанные
        // заказы значит завышать CPO вчетверо.
        if (campaign.block === WB_RK_BLOCK_ATTRIBUTED) continue;
        for (const [date, cell] of Object.entries(campaign.days)) {
          const block = campaignBlockAt(campaign, date);
          const agg = acc.get(block) ?? { spent: 0, allocated: 0, carts: 0, orders: 0, clicks: 0, views: 0, ordersSum: 0, skus: new Set<number>() };
          agg.spent += cell.spent;
          agg.allocated += cell.spentAllocated ?? 0;
          agg.carts += cell.carts;
          agg.orders += cell.orders;
          agg.clicks += cell.clicks;
          agg.views += cell.views;
          agg.ordersSum += cell.ordersSum;
          agg.skus.add(item.nm);
          acc.set(block, agg);
        }
      }
    }
    // Показываем ВСЕ виды размещения, даже пустые. Раньше карточка появлялась
    // только там, где кампании нашлись: набор менялся от кабинета к кабинету,
    // и отсутствующий вид читался как неподдерживаемый. «CPC полки» на СЛОЁНО
    // нет, а в Оптиме есть — панель обязана показывать это как ноль, а не как
    // отсутствие возможности.
    //
    // «Вид не определён» — исключение: это не тип размещения, а признак того,
    // что WB не отдал настройки. Пустым его рисовать незачем.
    const order = [...WB_RK_BLOCKS, WB_RK_BLOCK_UNKNOWN];
    return order
      .filter((block) => acc.has(block) || block !== WB_RK_BLOCK_UNKNOWN)
      .map((block) => {
        const agg = acc.get(block) ?? { spent: 0, allocated: 0, carts: 0, orders: 0, clicks: 0, views: 0, ordersSum: 0, skus: new Set<number>() };
        return {
          block,
          empty: !acc.has(block),
          // Пусто пусто́му рознь: «таких кампаний у кабинета нет вовсе» и «есть,
          // но за период не тратили» — разные факты, а надпись была одна.
          // Список видов кабинета приходит из справочника WB вместе с журналом;
          // null — справочник не прочитался, и утверждать нечего.
          existsInCabinet: knownBlocks == null ? null : knownBlocks.includes(block),
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
  }, [knownBlocks, taggedItems]);

  // Сколько конверсий осталось вне карточек. WB приписывает кампании заказы по
  // товарам, которых она не показывала: вида размещения у таких строк нет, и в
  // блок они не идут — иначе улучшили бы его CPO заказами, которых он не
  // покупал. Но и молчать про них нельзя: расход в карточках полный, а заказы
  // урезаны, и CPO выходит завышенным в разы.
  const outsideCards = useMemo(() => {
    let carts = 0;
    let orders = 0;
    let allOrders = 0;
    for (const item of taggedItems) {
      for (const campaign of item.campaigns) {
        for (const cell of Object.values(campaign.days)) {
          allOrders += cell.orders;
          if (campaign.block !== WB_RK_BLOCK_ATTRIBUTED) continue;
          carts += cell.carts;
          orders += cell.orders;
        }
      }
    }
    return { carts, orders, share: allOrders > 0 ? orders / allOrders : 0 };
  }, [taggedItems]);

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
        campaignBlockLabel(campaign),
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

  // Сколько товаров осталось без вида размещения: если такие есть, «нет
  // кампаний» в соседней карточке почти наверняка про них, и молчать нельзя.
  const unknownBlock = blockSummary.find((summary) => summary.block === WB_RK_BLOCK_UNKNOWN);
  // Одна надпись «нет кампаний» покрывала четыре разных факта, и человек шёл
  // искать свои полки в пустой карточке. Теперь причина называется прямо, а в
  // подсказке лежит остальное.
  const emptyBlockHint = (existsInCabinet: boolean | null) => [
    existsInCabinet == null
      ? "За выбранный период кампаний этого вида не нашлось. Есть ли они у кабинета вообще — сейчас неизвестно: справочник кампаний не прочитался."
      : existsInCabinet
        ? "Кампании этого вида у кабинета есть, но за выбранный период они не тратили."
        : "У кабинета нет ни одной кампании этого вида — WB не отдал ни одной такой настройки.",
    "Единая реклама считается отдельным видом (ЕРК), а кампания сразу на поиске и полках — видом «поиск + полки»: WB не делит её расход между площадками, поэтому в «полки» она не попадает.",
    unknownBlock ? `У ${unknownBlock.skus} товаров WB не отдал вид размещения — они в карточке «${WB_RK_BLOCK_UNKNOWN_LABEL}».` : "",
  ].filter(Boolean).join(" ");

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
            {canRunSync ? (
              <button
                type="button"
                onClick={() => void runSync()}
                disabled={syncing != null || loading}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-900 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 sm:min-h-0"
              >
                {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
                Прогнать РК
              </button>
            ) : null}
            <button
              type="button"
              onClick={exportCsv}
              disabled={!data || !visibleItems.length}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:min-h-0"
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </button>
            <button
              type="button"
              onClick={() => void refreshAll()}
              disabled={loading}
              // Отметка времени рядом — потому что журнал это ночной снимок:
              // цифры за день не меняются, и без неё нажатие выглядит как
              // отказ кнопки. Теперь видно, что обновление прошло.
              title={refreshedAt ? `Данные перечитаны в ${refreshedAt}. Журнал — снимок за предыдущий день, цифры за сутки не меняются; обновление подтягивает задачи, поставленные другими.` : "Перечитать журнал и задачи"}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:min-h-0"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Обновить
              {refreshedAt ? <span className="hidden font-normal text-slate-400 sm:inline">· {refreshedAt}</span> : null}
            </button>
          </>
        )}
      />
      {notePick && cabinetId ? (
        <WbRkNoteQuickPick
          cabinetId={cabinetId}
          nmId={notePick.nm}
          advertId={notePick.advertId}
          date={notePick.date}
          note={notes.get(rkNoteKey(notePick.nm, notePick.advertId, notePick.date))?.note ?? ""}
          done={notes.get(rkNoteKey(notePick.nm, notePick.advertId, notePick.date))?.done ?? false}
          anchor={{ x: notePick.x, y: notePick.y }}
          onSaved={applyNote}
          onClose={() => setNotePick(null)}
          onOpenFull={() => setNoteEdit({
            nm: notePick.nm, advertId: notePick.advertId, date: notePick.date,
            title: notePick.title, subtitle: notePick.subtitle,
          })}
        />
      ) : null}


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
          {/* Свёртка карточек — первое, что видно в строке: место на экране
              просили именно здесь. */}
          <button
            type="button"
            onClick={toggleCards}
            aria-expanded={cardsOpen}
            title={cardsOpen
              ? "Свернуть виды размещения в одну строку — таблица поднимется примерно на 230 пикселей"
              : "Развернуть виды размещения: CPO, CPL, CPC, CPM, ДРР и корзины по каждому"}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[12px] font-semibold text-slate-600 hover:border-violet-300 sm:min-h-0"
          >
            {cardsOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            Виды размещения
          </button>
          <button
            type="button"
            onClick={toggleDense}
            aria-pressed={dense}
            title={dense
              ? "Вернуть просторные строки: фото крупнее и название товара под номером"
              : "Плотные строки: остаются артикул и номер WB, название уходит в подсказку. На экране помещается вдвое больше товаров"}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-semibold sm:min-h-0 ${dense ? "border-violet-500 bg-violet-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-violet-300"}`}
          >
            <Rows3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Плотнее
          </button>
          {/* Подсказку держим только при развёрнутых карточках: в свёрнутом
              виде кликабельность видна по самим чипам, а строка чистая. */}
          {cardsOpen ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-[12px] font-medium text-violet-800">
              <MousePointerClick className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Нажмите на карточку — в таблице останутся только его кампании
            </span>
          ) : null}
          {blockFilter !== "all" ? (
            <button
              type="button"
              onClick={() => { setBlockFilter("all"); setWithBoth(false); }}
              className="inline-flex min-h-11 items-center gap-1 rounded-full border border-violet-300 bg-white px-2.5 py-1 text-[12px] font-semibold text-violet-700 hover:bg-violet-50 sm:min-h-0"
            >
              Показаны только «{WB_RK_BLOCK_LABELS[blockFilter as WbRkBlock] ?? blockFilter}» · сбросить ✕
            </button>
          ) : null}
          {/* Кампания, которую WB держит и в поиске, и на полках, живёт
              отдельным видом: расход между площадками он не делит. Искать её
              в «полках» человек всё равно будет — переключатель её туда
              добавляет, не смешивая деньги в карточках. */}
          {pairedBlock ? (
            <button
              type="button"
              onClick={() => setWithBoth((value) => !value)}
              aria-pressed={withBoth}
              title={`Кампании, которые WB держит и в поиске, и на полках, считаются отдельным видом «${WB_RK_BLOCK_LABELS[pairedBlock]}»: расход между площадками он не делит. Здесь их можно показать вместе с выбранным видом — деньги в карточках при этом остаются раздельными.`}
              className={`inline-flex min-h-11 items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-semibold sm:min-h-0 ${withBoth ? "border-violet-500 bg-violet-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-violet-300"}`}
            >
              {withBoth ? "✓ " : "+ "}«{WB_RK_BLOCK_LABELS[pairedBlock]}»
            </button>
          ) : null}
          {/* Наверх — те, по кому вчера реально жгли бюджет. Остальные не
              прячутся, а опускаются: спрятанная строка выглядит как потерянный
              товар, и её начинают искать. */}
          <button
            type="button"
            onClick={() => setWorkingFirst((value) => !value)}
            aria-pressed={workingFirst}
            disabled={!data}
            title={`Наверх — артикулы, на которые в последний день окна ушло не меньше ${CTR_MIN_CAMPAIGN_SPEND} ₽. Порог в рублях, а не в показах: кампания на трёх рублях показов набрать могла, а решать по ней нечего. Остальные остаются ниже.`}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-semibold disabled:opacity-40 sm:min-h-0 ${workingFirst ? "border-violet-500 bg-violet-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-violet-300"}`}
          >
            <ArrowUpNarrowWide className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Сначала рабочие
            {workingFirst && workingCount != null ? <span className="rounded bg-white/20 px-1 tabular-nums">{workingCount}</span> : null}
          </button>
          {/* Перенос вчерашних задач: заполняет только пустые клетки, чужое
              решение не трогает. */}
          {canWrite && hasExactCabinet && (data?.dates?.length ?? 0) >= 2 ? (
            <button
              type="button"
              onClick={() => void copyYesterday()}
              disabled={copying}
              title={`Поставить задачи с ${dayLabel((data?.dates ?? []).at(-2) ?? "")} на ${dayLabel((data?.dates ?? []).at(-1) ?? "")} там, где на ${dayLabel((data?.dates ?? []).at(-1) ?? "")} ещё пусто. Уже стоящие задачи не трогаются, отметка «сделано» не переносится.`}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[12px] font-semibold text-slate-600 hover:border-violet-300 disabled:opacity-40 sm:min-h-0"
            >
              {copying ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <CopyPlus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
              Перенести задачи со вчера
            </button>
          ) : null}
          {copyResult ? <span className="text-[12px] text-slate-500">{copyResult}</span> : null}
          <button
            type="button"
            onClick={() => setShowNotes((value) => !value)}
            aria-pressed={showNotes}
            className={`ml-auto inline-flex min-h-11 items-center rounded-lg border px-2.5 py-1 text-[12px] font-semibold sm:min-h-0 ${showNotes ? "border-violet-300 bg-violet-50 text-violet-700" : "border-slate-200 text-slate-500 hover:border-slate-300"}`}
          >
            {showNotes ? "Скрыть столбец задач" : "Показать столбец задач"}
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
            {/* Видов размещения семь, а сетка была на шесть колонок — ЕРК уезжала на
                вторую строку и таблица уходила ниже экрана. Держим все семь в один
                ряд на широком экране; на узких переносим по-прежнему. */}
            {cardsOpen ? null : (
              // Свёрнутый вид: та же сумма и тот же клик-фильтр, одна строка
              // вместо четырёх рядов. Прокручивается вбок на узком экране.
              <div className="scroll-x mb-2 flex gap-1.5 pb-1">
                {blockSummary.map((summary) => (
                  <button
                    key={summary.block}
                    type="button"
                    onClick={() => { if (!summary.empty) setBlockFilter(blockFilter === summary.block ? "all" : summary.block); }}
                    disabled={summary.empty}
                    title={summary.empty
                      ? `«${summary.label}»: ${emptyBlockHint(summary.existsInCabinet)}`
                      : `${summary.label}: ${money(summary.spent)} ₽ · CPO ${money2(summary.cpo)} · ДРР ${summary.drr == null ? "—" : `${summary.drr.toFixed(1)}%`} · артикулов ${count(summary.skus)}. Нажмите, чтобы оставить в таблице только эти кампании.`}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition ${
                      summary.empty
                        ? "border-dashed border-slate-200 bg-slate-50/50 text-slate-400"
                        : blockFilter === summary.block
                          ? "border-violet-500 bg-violet-50 text-violet-800 ring-1 ring-violet-200"
                          : "border-slate-200 bg-white text-slate-600 hover:border-violet-300"
                    }`}
                  >
                    <span className="font-semibold uppercase tracking-wide">{summary.label}</span>
                    <span className="font-bold tabular-nums">{summary.empty ? "—" : `${money(summary.spent)} ₽`}</span>
                  </button>
                ))}
              </div>
            )}

            <div className={`mb-3 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 ${cardsOpen ? "grid" : "hidden"}`}>
              {blockSummary.map((summary) => (
                <div key={summary.block} className="relative">
                  {/* Почему вид пуст — объяснение висело на ОТКЛЮЧЁННОЙ кнопке:
                      её `title` браузер не показывает даже мышью, а на касании
                      подсказок нет вовсе. Значок стоит рядом, вне кнопки. */}
                  {summary.empty ? (
                    <Hint label={`Почему «${summary.label}» без данных`} className="absolute right-2 top-2 z-10">
                      {emptyBlockHint(summary.existsInCabinet)}
                    </Hint>
                  ) : null}
                  <button
                  type="button"
                  onClick={() => { if (!summary.empty) setBlockFilter(blockFilter === summary.block ? "all" : summary.block); }}
                  disabled={summary.empty}
                  className={
                    summary.empty
                      // Пустой вид показываем, но приглушённо и без наведения: это
                      // «ноль кампаний», а не «фильтр, который ничего не даст».
                      ? "relative rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-2.5 text-left"
                      : `group/card relative cursor-pointer rounded-xl border p-2.5 text-left transition hover:-translate-y-0.5 hover:shadow-md ${blockFilter === summary.block ? "border-violet-500 bg-violet-50/40 shadow-sm ring-1 ring-violet-200" : "border-slate-200 bg-white hover:border-violet-300"}`
                  }
                >
                  {/* Иконка фильтра проявляется под курсором: карточка сама
                      сообщает, что она не просто сводка. */}
                  {summary.empty ? null : <Filter className={`absolute right-2 top-2 h-3 w-3 transition-opacity ${blockFilter === summary.block ? "text-violet-600 opacity-100" : "text-violet-400 opacity-0 group-hover/card:opacity-100"}`} aria-hidden="true" />}
                  <div className={`truncate pr-4 text-[11px] font-semibold uppercase tracking-wide ${summary.empty ? "text-slate-400" : blockFilter === summary.block ? "text-violet-700" : "text-slate-500"}`}>{summary.label}</div>
                  <div className={`mt-1 font-bold tabular-nums ${summary.empty ? "text-[13px] leading-tight text-slate-400" : "text-lg text-slate-900"}`}>
                    {summary.empty
                      ? summary.existsInCabinet == null
                        ? "нет данных за период"
                        : summary.existsInCabinet ? "за период не тратили" : "нет таких кампаний"
                      : `${money(summary.spent)} ₽`}
                  </div>
                  {summary.empty ? null : <dl className="mt-1 space-y-0.5 text-[11px] text-slate-500">
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
                    <div className="flex justify-between gap-2"><dt className="whitespace-nowrap">Корзин/заказов</dt><dd className="whitespace-nowrap tabular-nums">{count(summary.carts)}/{count(summary.orders)}</dd></div>
                    <div className="flex justify-between gap-2"><dt>Артикулов</dt><dd className="tabular-nums">{count(summary.skus)}</dd></div>
                    {summary.allocated > 0 ? (
                      // WB отдаёт часть расхода только суммой по кампании: эта
                      // доля разложена по артикулам пропорционально показам.
                      <div className="flex justify-between gap-2 text-slate-400">
                        <dt>из них разложено</dt>
                        <dd className="tabular-nums">{money(summary.allocated)} ₽</dd>
                      </div>
                    ) : null}
                  </dl>}
                  </button>
                </div>
              ))}
            </div>

            {/* Расход в карточках полный, а заказы — только те, что WB привязал
                к показу этого артикула. Пока доля привязанных мала, CPO и ДРР
                карточек завышены, и молчать об этом нельзя: красный CPO читается
                как «реклама дорогая», а не как «знаменатель неполный». */}
            {outsideCards.orders > 0 ? (
              // Три строки объяснения занимали 54 пикселя постоянно, а читают
              // их один раз. Оставляем факт, объяснение — по требованию.
              <details className="mb-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-1.5 text-[11px] leading-relaxed text-amber-800">
                <summary className="cursor-pointer list-none marker:content-none">
                  Вне карточек осталось {count(outsideCards.orders)} заказов и {count(outsideCards.carts)} корзин
                  {outsideCards.share > 0 ? ` — ${Math.round(outsideCards.share * 100)}% заказов периода` : ""}
                  <span className="ml-1 font-semibold underline decoration-dotted">почему это важно</span>
                </summary>
                <p className="mt-1">
                  WB приписал их кампаниям, которые этот артикул не показывали. Вида размещения у таких строк нет,
                  поэтому CPO и ДРР в карточках выше настоящих. Полные цифры — в строке артикула и в «Итого».
                </p>
              </details>
            ) : null}

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
              <div
                onScroll={(event) => {
                  const next = event.currentTarget.scrollLeft > 0;
                  setScrolledAside((prev) => (prev === next ? prev : next));
                }}
                // Высота считается в dvh: в мобильном браузере vh меряется по
                // развёрнутой адресной строке, и низ таблицы вместе с «Итого»
                // оказывался под панелью браузера. Нижняя граница в 360px нужна
                // телефону в ландшафте — там 100dvh−320px это полторы строки.
                className="max-h-[max(360px,calc(100dvh-320px))] overflow-auto rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
              >
                <table className="min-w-full border-collapse text-xs">
                  {/* Шапка липнет к верху контейнера, первая колонка — к левому
                      краю: на 30 днях таблица уезжает в обе стороны, и без
                      этого не понять, какой день и чей артикул перед глазами. */}
                  <thead className="sticky top-0 z-30">
                    <tr className="bg-slate-50 text-slate-500 shadow-[0_1px_0_rgba(226,232,240,1)]">
                      <th className={`sticky left-0 z-40 bg-slate-50 px-3 py-2 text-left font-semibold ${STICKY_EDGE}`}>Артикул</th>
                      <th className="bg-slate-50 px-2 py-2 text-left font-medium">
                        {/* Оговорка про вид размещения относилась ко всему
                            столбцу и повторялась в каждой строке — один значок
                            у заголовка объясняет его целиком. */}
                        <span className="inline-flex items-center gap-1">
                          Кампании
                          <Hint label="Как читать вид размещения">
                            Вид размещения по дням: за дни со снимком — как было тогда, за остальные — по нынешним настройкам кампании.
                          </Hint>
                        </span>
                      </th>
                      {dates.map((date) => (
                        <th key={date} colSpan={dayCols} className="border-l border-slate-200 bg-slate-50 px-2 py-2 text-center font-semibold text-slate-700">
                          {dayLabel(date)}
                          {/* Три состояния, а не два. «Снят» раньше значило
                              «за день есть хоть одна строка снимка», и это
                              и было причиной занижения: снимок 06:00 ловит
                              часть кабинета. Теперь «снят» — покрыт целиком,
                              «частично» — ставки из снимка, метрики из слоя. */}
                          {/* Слово «снят»/«частично»/«live» — про ЭТОТ день, у
                              соседнего оно другое, поэтому пояснение стоит в
                              шапке каждого дня, а не одной общей легендой. */}
                          {data.snapshotDates.includes(date)
                            ? <><span className="ml-1 font-normal text-emerald-600">снят</span><Hint className="ml-0.5" label={`Откуда данные за ${dayLabel(date)}`}>Снимок 06:00 МСК покрыл день целиком: и метрики, и ставки — из него.</Hint></>
                            : (data.partialDates ?? []).includes(date)
                              ? <><span className="ml-1 font-normal text-amber-600">частично</span><Hint className="ml-0.5" label={`Откуда данные за ${dayLabel(date)}`}>Снимок за этот день неполный: метрики взяты из слоя кампаний, ставки — из снимка там, где он их запомнил.</Hint></>
                              : <><span className="ml-1 font-normal text-slate-400">live</span><Hint className="ml-0.5" label={`Откуда данные за ${dayLabel(date)}`}>Снимка за этот день нет: считается на лету, ставка текущая.</Hint></>}
                        </th>
                      ))}
                    </tr>
                    <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400 shadow-[0_1px_0_rgba(226,232,240,1)]">
                      <th className={`sticky left-0 z-40 bg-slate-50 px-3 pb-2 ${STICKY_EDGE}`} />
                      <th className="bg-slate-50 px-2 pb-2" />
                      {dates.map((date) => (
                        <Fragment key={date}>
                          <th className="min-w-[78px] border-l border-slate-200 bg-slate-50 px-2 pb-2 text-right font-normal">Ставка</th>
                          <th className="min-w-[58px] bg-slate-50 px-2 pb-2 text-right font-normal">Корзин</th>
                          <th className="min-w-[62px] bg-slate-50 px-2 pb-2 text-right font-normal">Заказов</th>
                          <th className="min-w-[62px] bg-slate-50 px-2 pb-2 text-right font-normal">Затраты</th>
                          <th className="min-w-[70px] bg-slate-50 px-2 pb-2 text-right font-normal">CPO</th>
                          <th className="min-w-[70px] bg-slate-50 px-2 pb-2 text-right font-normal">CPL</th>
                          {showNotes ? <th className={`border-l border-slate-200 bg-violet-50 px-2 pb-2 text-center font-semibold text-violet-700 ${TASK_COL}`}>Задача</th> : null}
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
                      // Фильтр по виду уже применён в visibleItems, причём по
                      // дням: фильтровать здесь второй раз по ярлыку строки
                      // значило бы выбросить кампанию, которая сменила площадку
                      // внутри окна и подходит фильтру частью своих дней.
                      const shown = item.campaigns;
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
                            <td className={`sticky left-0 z-20 px-2 sm:px-3 ${dense ? "py-1" : "py-2"} ${STICKY_EDGE} ${open ? "bg-violet-100" : "bg-white group-hover/row:bg-violet-50"}`}>
                              <div className="flex items-center gap-1.5 sm:gap-2.5">
                                <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`} />
                                {/* Картинка WB лежит на одном из нескольких «баскетов», и по
                                    номеру он только угадывается. Одна ссылка промахивалась —
                                    у части артикулов вместо фото была заглушка. Компонент
                                    перебирает варианты, как в Воронке и Полках.
                                    На телефоне фото уходит: закреплённая колонка съедала
                                    260px из 320, и на цифры дня не оставалось ничего.
                                    Товар опознаётся артикулом и номером — они остаются. */}
                                <span className="hidden shrink-0 sm:block">
                                  <WbProductImage
                                    nm={item.nm}
                                    label={article}
                                    className={`shrink-0 rounded-md bg-slate-100 object-cover ring-1 ring-slate-200/60 ${dense ? "h-7 w-6" : "h-11 w-9"}`}
                                  />
                                </span>
                                {/* Ширина колонки на телефоне задана жёстко: иначе её
                                    растягивает самый длинный артикул, и таблица начинается
                                    за краем экрана. */}
                                <div className="w-[104px] sm:w-auto sm:min-w-0">
                                  {/* В плотном режиме артикул, номер и ярлык идут одной
                                      строкой: перенос ярлыка на второй ярус и был тем,
                                      что держало строку в 62 пикселя. На телефоне
                                      перенос остаётся — там ширины нет. */}
                                  <div className={`flex items-center gap-1.5 ${dense ? "flex-wrap sm:flex-nowrap" : "flex-wrap"}`}>
                                    {/* Обрезанный артикул на телефоне бесполезен ровно
                                        так же, как обрезанный номер WB ниже: по нему
                                        товар в кабинете не найти. До sm переносим. */}
                                    <span className="break-anywhere max-w-[104px] text-[13px] font-bold tracking-[-0.01em] text-slate-800 sm:max-w-[150px] sm:truncate" title={[article || `WB ${item.nm}`, dense ? name : null].filter(Boolean).join(" · ")}>{article || `WB ${item.nm}`}</span>
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
                                    {/* Номер WB в плотном режиме встаёт рядом с
                                        артикулом, а не под ним. */}
                                    {dense ? <span className="hidden shrink-0 text-[10px] font-normal tabular-nums text-slate-400 sm:inline">{item.nm}</span> : null}
                                  </div>
                                  {dense ? null : <div className="break-anywhere max-w-[104px] text-[11px] font-normal tabular-nums text-slate-400 sm:max-w-[168px] sm:truncate">WB {item.nm}</div>}
                                  {/* Название — третий ярус строки. В плотном режиме
                                      оно уходит в подсказку артикула: товар опознают по
                                      артикулу и номеру, а название читают редко. */}
                                  {name && !dense ? <div className="max-w-[104px] truncate text-[11px] font-normal text-slate-500 sm:max-w-[168px]" title={name}>{name}</div> : null}
                                </div>
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-[11px] font-normal text-slate-500">
                              {shown.length} {shown.length === 1 ? "кампания" : shown.length < 5 ? "кампании" : "кампаний"}
                            </td>
                            {dates.map((date) => {
                              const cell = item.days[date];
                              const note = notes.get(rkNoteKey(item.nm, null, date));
                              const noteBadge = showNotes ? noteChip(note, (event) => openNote(event, {
                                nm: item.nm, advertId: null, date,
                                title: article || `WB ${item.nm}`, subtitle: "Задача по товару",
                              }), "Добавить задачу на этот день") : null;
                              if (isEmpty(cell)) {
                                return (
                                  <Fragment key={date}>
                                    {/* Прочерк объединяет только колонки метрик: раньше он
                                        захватывал и «Задачу», и кнопка оказывалась посреди дня. */}
                                    <td colSpan={6} className="border-l border-slate-200 px-2 py-1.5 text-center font-normal text-slate-300">—</td>
                                    {showNotes ? <td className={`px-1 py-1.5 text-center ${TASK_CELL} ${TASK_COL}`}>{noteBadge}</td> : null}
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
                                  <td className="whitespace-nowrap border-l border-slate-200 px-2 py-1.5 text-right tabular-nums text-slate-500">{bidRange(shown, date)}</td>
                                  <td className="px-2 py-1.5 text-right tabular-nums">{count(cell.carts)}</td>
                                  <td className="px-2 py-1.5 text-right tabular-nums">{count(cell.orders)}</td>
                                  <td className="px-2 py-1.5 text-right tabular-nums">{money(cell.spent)}</td>
                                  <ToneCell value={cpo} tone={cpoTone(cpo)} fraction />
                                  <ToneCell value={cpl} tone={cplTone(cpl)} fraction edge />
                                  {showNotes ? <td className={`px-1 py-1.5 text-center ${TASK_CELL} ${TASK_COL}`}>{noteBadge}</td> : null}
                                </Fragment>
                              );
                            })}
                          </tr>
                          {open ? shown.map((campaign) => (
                            <tr key={`${item.nm}-${campaign.advertId ?? campaign.block}`} className="bg-slate-50/60 text-slate-600 transition-colors hover:bg-violet-50/30">
                              {/* Отступ повторяет ширину фото и стрелки в строке
                                  артикула — на телефоне фото нет, и он короче. */}
                              <td className={`sticky left-0 z-20 bg-slate-50 py-1.5 pl-7 pr-2 sm:pl-[68px] sm:pr-3 ${STICKY_EDGE}`}>
                                <div className={`max-w-[112px] truncate text-[11px] sm:max-w-[196px] ${campaign.block === WB_RK_BLOCK_ATTRIBUTED ? "italic text-slate-400" : ""}`} title={campaign.name ?? undefined}>
                                  {campaign.block === WB_RK_BLOCK_ATTRIBUTED
                                    ? WB_RK_BLOCK_ATTRIBUTED_LABEL
                                    : campaign.name ?? (campaign.advertId ? `Кампания ${campaign.advertId}` : "—")}
                                </div>
                                {campaign.nmCount && campaign.nmCount > 1 ? (
                                  // Имя кампании бывает от соседнего товара — показываем охват.
                                  <div className="text-[10px] text-slate-400">на {campaign.nmCount} артикулов</div>
                                ) : null}
                              </td>
                              <td
                                // Стрелка — не всегда наблюдённое переключение:
                                // вид дня берётся из снимка, а где снимка нет —
                                // из нынешних настроек кампании. Обещать
                                // историю площадок там, где её никто не
                                // записывал, нельзя. Оговорка переехала в
                                // заголовок столбца: в строках она повторялась
                                // слово в слово и на касании не открывалась.
                                className="whitespace-nowrap px-2 py-1 text-[11px]"
                              >
                                {campaignBlockLabel(campaign)}
                              </td>
                              {dates.map((date) => {
                                const cell = campaign.days[date];
                                // Заметка по кампании: «поднять ставку» относится к ней,
                                // а не к товару целиком — уровни разные.
                                const cNote = campaign.advertId == null ? undefined : notes.get(rkNoteKey(item.nm, campaign.advertId, date));
                                const cBadge = showNotes && campaign.advertId != null ? noteChip(cNote, (event) => openNote(event, {
                                  nm: item.nm, advertId: campaign.advertId, date,
                                  title: campaign.name ?? `Кампания ${campaign.advertId}`, subtitle: article || `WB ${item.nm}`,
                                }), "Добавить задачу по кампании") : null;
                                if (isEmpty(cell)) {
                                  return (
                                    <Fragment key={date}>
                                      <td colSpan={6} className="border-l border-slate-200 px-2 py-1 text-center text-slate-300">—</td>
                                      {showNotes ? <td className={`px-1 py-1 text-center ${TASK_CELL} ${TASK_COL}`}>{cBadge}</td> : null}
                                    </Fragment>
                                  );
                                }
                                const cpo = costPerOrder(cell.spent, cell.orders);
                                const cpl = costPerCart(cell.spent, cell.carts);
                                return (
                                  <Fragment key={date}>
                                    <td
                                      className="border-l border-slate-200 px-2 py-1 text-right tabular-nums"
                                      // У «поиск + полки» ставок две, и они почти
                                      // всегда разные. Одна колонка показывала
                                      // поисковую и молча прятала полочную.
                                      title={cell.bidAlt == null ? undefined : `Поиск ${money2(cell.bid)} · полки ${money2(cell.bidAlt)}`}
                                    >
                                      {cell.bid == null ? "—" : money2(cell.bid)}
                                      {cell.bidAlt == null ? null : <span className="text-slate-400"> / {money2(cell.bidAlt)}</span>}
                                    </td>
                                    <td className="px-2 py-1 text-right tabular-nums">{count(cell.carts)}</td>
                                    <td className="px-2 py-1 text-right tabular-nums">{count(cell.orders)}</td>
                                    <td className="px-2 py-1 text-right tabular-nums">{money(cell.spent)}</td>
                                    <ToneCell value={cpo} tone={cpoTone(cpo)} fraction />
                                    <ToneCell value={cpl} tone={cplTone(cpl)} fraction edge />
                                    {showNotes ? <td className={`px-1 py-1 text-center ${TASK_CELL} ${TASK_COL}`}>{cBadge}</td> : null}
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
                      <td className={`sticky left-0 z-40 bg-slate-100 px-3 py-2 ${STICKY_EDGE}`}>Итого</td>
                      <td className="bg-slate-100 px-2 py-2 font-normal text-slate-500">{visibleItems.length} артикулов</td>
                      {dates.map((date) => {
                        const total = dayTotals.get(date);
                        if (!total || (!total.spent && !total.carts && !total.orders)) {
                          return <td key={date} colSpan={dayCols} className="border-l border-slate-200 bg-slate-100 px-2 py-2 text-center font-normal text-slate-300">—</td>;
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
                            <ToneCell value={cpl} tone={cplTone(cpl)} fraction edge />
                            {showNotes ? <td className={`${TASK_CELL} ${TASK_COL}`} /> : null}
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
