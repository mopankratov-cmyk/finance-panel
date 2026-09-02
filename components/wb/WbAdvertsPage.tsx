"use client";

import { Archive, ChevronRight, KeyRound, Loader2, Megaphone, PauseCircle, PlayCircle, RefreshCw, Search, WalletCards } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoadingBanner, SkeletonCards, useElapsedSeconds } from "@/components/ui/LoadingState";
import { MARKETPLACE_METRICS, METRIC_BADGE_TONE, marketplaceMetricStatus } from "@/lib/analytics/marketplaceMetrics";
import { compareAdvertCampaigns } from "@/lib/adverts/campaignSort";
import { CategoryFilter, filterByCategory } from "@/components/ui/CategoryFilter";
import { deploymentPinnedFetch } from "@/lib/http/deploymentPinnedFetch";
import { withPlural } from "@/lib/ozon/plural";
import { useCategoryMap } from "@/lib/useCategoryMap";
import { readOkApiResponse } from "@/lib/http/readApiResponse";
import { useDashboardFilter } from "@/lib/useDashboardFilter";
import { WbProductImage } from "./WbProductImage";
import { WbEmptyState, WbErrorState, WbModuleHeader } from "./WbModuleHeader";
import { useWbCabinet } from "./WbCabinetContext";
import { AdActionsPanel } from "./ads/AdActionsPanel";
import { AdClustersTab } from "./ads/AdClustersTab";
import { AdJournalTab } from "./ads/AdJournalTab";
import { AdRulesTab } from "./ads/AdRulesTab";
import { AdTokenPanel } from "./ads/AdTokenPanel";
import { ConfirmAction, type ConfirmRequest } from "./ads/ConfirmAction";
import type { CampaignRow as AdCampaignRow } from "./ads/campaignRow";
import { adPost, money as adMoney, type AdCabinetConfig } from "./ads/adControlApi";

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

interface CampaignDaySummary {
  date: string;
  is_complete: boolean;
  views: number | null;
  clicks: number | null;
  ctr: number | null;
  spend: number | null;
  attributed_revenue: number | null;
  attributed_drr: number | null;
  open_card: number | null;
  carts: number | null;
  orders_count: number | null;
  orders_sum: number | null;
  stats_synced_at: string | null;
  stats_age_hours: number | null;
}

interface Campaign {
  id: number;
  name: string;
  status: number;
  enabled: boolean;
  budget: number;
  bid_cpm_rub: number | null;
  stats_synced_at: string | null;
  stats_age_hours: number | null;
  stats_stale: boolean;
  spend_today: number;
  spent_14: number;
  ad_revenue_14: number;
  drr: number | null;
  spent_7_closed: number;
  ad_revenue_7_closed: number;
  drr_attributed_7_closed: number | null;
  drr_attributed_7_status: "ready" | "no_attributed_orders" | "no_spend";
  metrics_period_7_closed: { date_from: string; date_to: string };
  bid_type?: string;
  payment?: string;
  yesterday?: CampaignDaySummary;
  today_open?: CampaignDaySummary;
  days: DayPoint[];
  economics: AdvertEconomics;
  attribution_compatible: boolean;
  nm_count: number | null;
  last_change: { old_bid: number | null; new_bid: number | null; created_at: string } | null;
  comparison: BeforeAfter | null;
}

interface Article {
  nm: number;
  art: string;
  photo: string;
  spend: number;
  spent_sku_7_closed: number | null;
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
  spend_unattributed?: { today: number; yesterday: number; campaigns: number };
  today?: string;
  yest?: string;
}

interface CampaignRow {
  article: Article;
  campaign: Campaign;
}

type CampaignStatusFilter = "active" | "paused" | "archive" | "all";

/**
 * Разделы объединённого модуля.
 *
 * «Что мы меняли», а не «Журнал»: рядом в меню стоит «Журнал РК», и два журнала
 * в одном контуре гарантируют путаницу. Здесь наши намерения, там факт открутки.
 */
const MODULE_VIEWS = [
  { value: "campaigns", label: "Кампании" },
  { value: "phrases", label: "Фразы и кластеры" },
  { value: "rules", label: "Автоправила" },
  { value: "log", label: "Что мы меняли" },
] as const;

type ModuleView = (typeof MODULE_VIEWS)[number]["value"];

const STATUS_FILTERS = [
  { value: "active", label: "Активные", Icon: PlayCircle },
  { value: "paused", label: "Пауза", Icon: PauseCircle },
  { value: "archive", label: "Архив", Icon: Archive },
  { value: "all", label: "Все", Icon: Megaphone },
] as const;

const ROW_HEIGHT = 76;
const rub = (value: number | null) => value == null ? "—" : `${Math.round(value).toLocaleString("ru-RU")} ₽`;
const pct = (value: number | null) => value == null ? "—" : `${Math.round(value * 10) / 10}%`;
const int = (value: number | null) => value == null ? "—" : Math.round(value).toLocaleString("ru-RU");

function emptyDaySummary(date: string | undefined, isComplete: boolean): CampaignDaySummary {
  return {
    date: date ?? "—",
    is_complete: isComplete,
    views: null,
    clicks: null,
    ctr: null,
    spend: null,
    attributed_revenue: null,
    attributed_drr: null,
    open_card: null,
    carts: null,
    orders_count: null,
    orders_sum: null,
    stats_synced_at: null,
    stats_age_hours: null,
  };
}

function syncLabel(summary: CampaignDaySummary) {
  if (summary.stats_age_hours == null) return "синк не найден";
  if (summary.stats_age_hours <= 1) return "синк свежий";
  return `синк ${summary.stats_age_hours} ч назад`;
}

/**
 * Почему сравнения «до / после» нет.
 *
 * Общая фраза «нужны минимум два дня статистики» верна, но не отвечает на
 * вопрос человека, который смотрит на пустой блок. Причин ровно три, и они
 * требуют разных действий: подождать, забыть или поменять ставку.
 */
function beforeAfterReason(campaign: Campaign): string {
  const change = campaign.last_change;
  if (!change) return "Ставку этой кампании через панель ещё не меняли — сравнивать нечего.";
  const days = Math.floor((Date.now() - new Date(change.created_at).getTime()) / 86_400_000);
  if (days < 2) return `Ставку меняли ${days === 0 ? "сегодня" : "вчера"} — для сравнения нужно ещё как минимум два полных дня после правки.`;
  if (days > 12) return `Последняя правка ставки была ${days} дн. назад и вышла за 14-дневное окно статистики — сравнивать её уже не с чем.`;
  return "Не хватает дней с расходом по одну из сторон от правки: нужно минимум по два дня до и после.";
}

/**
 * Модель оплаты кампании — по тому, что сказал WB.
 *
 * Это НЕ то же самое, что тип ставки, и путать их дорого. Живая проверка
 * 02.09.2026 поймала ровно эту путаницу: бейдж строки писал «единая», потому
 * что оплата CPM, а панель действий на той же карточке предлагала выбрать
 * место показа — то есть ставка ручная. Два утверждения об одной кампании на
 * одном экране, и одно из них ложное.
 *
 * Фильтр рядом всегда отбирал именно по оплате: «не CPC и известно» он называл
 * «Единой». Теперь он называется тем, чем является.
 */
function campaignPaymentKind(campaign: Campaign): "cpc" | "cpm" | "unknown" {
  if (campaign.payment === "cpc") return "cpc";
  if (campaign.payment === "cpm") return "cpm";
  // Старые кампании синхронизировались до появления payment_type. Тип ставки
  // у них есть, и по нему оплату можно назвать: единая ставка — всегда за показы.
  if (campaign.bid_type === "unified" || campaign.bid_type === "auto") return "cpm";
  return "unknown";
}

/** Тип ставки: кто выбирает место показа и запросы — человек или алгоритм WB. */
function campaignBidKind(campaign: Campaign): "manual" | "unified" | "unknown" {
  const raw = String(campaign.bid_type ?? "").toLowerCase();
  if (raw === "unified" || raw === "auto" || raw === "automatic") return "unified";
  if (raw === "manual" || raw === "cpm" || raw === "auction") return "manual";
  return "unknown";
}

/**
 * Риск остатка словом рядом с числом.
 *
 * «23,6 дн.» само по себе ничего не требует, и глаз проходит мимо. Ровно этот
 * риск при этом сильнее всех прочих доводов в рекомендации: кончился товар —
 * реклама жжёт бюджет в никуда, какой бы хороший ДРР ни был.
 */
/**
 * Вердикт кампании в строке списка.
 *
 * Панель считает его для КАЖДОЙ из 238 кампаний и до сих пор показывала только
 * в карточке одной выбранной. В кабинете это 49 «снизить или пауза» и 12
 * «поднять» — чтобы их найти, менеджеру приходилось открывать карточки по одной.
 *
 * Процента здесь намеренно НЕТ, хотя он посчитан. Поле называется
 * budgetChangePct и относится к РАСХОДУ, а единственный рычаг модуля — ставка
 * CPM: снизить ставку на 20% не значит снизить расход на 20%. Направление
 * осмысленно и его достаточно для триажа, а число рядом с полем ставки
 * превращается в инструкцию, которой оно не является. Величина и объяснение
 * остаются в карточке, где есть место сказать, к чему они относятся.
 *
 * «Держать» не показывается вовсе: таких кампаний 171 из 238, и бейдж на каждой
 * второй строке перестаёт быть сигналом.
 */
const VERDICT_BADGE: Record<string, { label: string; className: string } | null> = {
  pause: { label: "Остановить", className: "bg-rose-100 text-rose-700" },
  decrease: { label: "Снизить расход", className: "bg-amber-100 text-amber-800" },
  increase: { label: "Можно поднять", className: "bg-emerald-100 text-emerald-700" },
  insufficient: { label: "Нет данных", className: "bg-slate-100 text-slate-500" },
  hold: null,
};

/**
 * Порядок срочности вердиктов. По рублям ожидаемого эффекта список
 * СОЗНАТЕЛЬНО не сортируется: это линейная экстраполяция средней отдачи на
 * предельную трату, а у убыточного товара формула даёт «остановка кампании с
 * расходом 10 000 ₽ принесёт 20 000 ₽». Складывать такую оценку в один
 * порядок с измеренным расходом — ранжировать несравнимое.
 */
const VERDICT_RANK: Record<string, number> = { pause: 0, decrease: 1, increase: 2, insufficient: 3, hold: 4 };

const STOCK_RISK_NOTE: Record<string, string> = {
  out: " · товар кончился",
  critical: " · критично",
  warning: " · на исходе",
  ok: "",
  unknown: "",
};

const PAYMENT_BADGE: Record<"cpc" | "cpm" | "unknown", { label: string; className: string }> = {
  cpc: { label: "CPC", className: "bg-sky-50 text-sky-700" },
  cpm: { label: "CPM", className: "bg-violet-50 text-violet-700" },
  unknown: { label: "оплата ?", className: "bg-slate-100 text-slate-500" },
};

const BID_BADGE: Record<"manual" | "unified" | "unknown", { label: string; className: string }> = {
  manual: { label: "ручная", className: "bg-amber-50 text-amber-700" },
  unified: { label: "единая", className: "bg-emerald-50 text-emerald-700" },
  unknown: { label: "ставка ?", className: "bg-slate-100 text-slate-500" },
};

function campaignStatusKind(campaign: Campaign): Exclude<CampaignStatusFilter, "all"> {
  if (campaign.status === 9 || campaign.enabled) return "active";
  if (campaign.status === 7) return "archive";
  return "paused";
}

function campaignStatusMeta(campaign: Campaign) {
  const kind = campaignStatusKind(campaign);
  if (kind === "active") return { label: "Активна", Icon: PlayCircle, dot: "bg-emerald-400", tone: "bg-emerald-50 text-emerald-700" };
  if (kind === "archive") return { label: "Архив", Icon: Archive, dot: "bg-slate-300", tone: "bg-slate-100 text-slate-600" };
  return { label: "Пауза", Icon: PauseCircle, dot: "bg-amber-400", tone: "bg-amber-50 text-amber-700" };
}

function drrTone(value: number | null) {
  return METRIC_BADGE_TONE[marketplaceMetricStatus("drrAttributed", value)];
}

function closedDrrLabel(campaign: Campaign) {
  if (campaign.drr_attributed_7_status === "no_attributed_orders") return "∞";
  return pct(campaign.drr_attributed_7_closed);
}

function closedDrrTitle(campaign: Campaign) {
  if (campaign.drr_attributed_7_status === "no_attributed_orders") return "Нет атрибутированных заказов: расход есть, выручка с рекламы равна нулю";
  if (campaign.drr_attributed_7_status === "no_spend") return "За 7 закрытых дней расхода не было";
  return `${MARKETPLACE_METRICS.drrAttributed.definition}. ДРР рекламы не равно ДРР к заказам во Воронке: здесь знаменатель — только атрибутированная рекламой выручка.`;
}

function closedDrrTone(campaign: Campaign) {
  if (campaign.drr_attributed_7_status === "no_attributed_orders") return "border-rose-200 bg-rose-50 text-rose-700";
  if (campaign.drr_attributed_7_status === "no_spend") return "border-slate-200 bg-slate-50 text-slate-500";
  return drrTone(campaign.drr_attributed_7_closed);
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
  const [dataKey, setDataKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [query, setQuery] = useDashboardFilter<string>("q", "", undefined, 300);
  const [kind, setKind] = useDashboardFilter<"all" | "cpc" | "cpm" | "unknown">("kind", "all", ["all", "cpc", "cpm", "unknown"]);
  const [statusFilter, setStatusFilter] = useDashboardFilter<CampaignStatusFilter>("status", "active", ["active", "paused", "archive", "all"]);
  // Выбранная кампания живёт в адресе страницы. Это не «чтобы можно было
  // поделиться ссылкой» (хотя и это тоже): выбор — часть состояния, за которым
  // закреплены будущие кнопки действий, и терять его при перерисовке нельзя.
  const [selectedParam, setSelectedParam] = useDashboardFilter<string>("campaign", "");
  const selectedId = selectedParam ? Number(selectedParam) : null;
  const setSelectedId = useCallback(
    (id: number | null) => setSelectedParam(id == null ? "" : String(id)),
    [setSelectedParam],
  );
  const [rowWindow, setRowWindow] = useState({ start: 0, end: 16 });
  const [view, setView] = useDashboardFilter<ModuleView>("view", "campaigns", MODULE_VIEWS.map((item) => item.value));
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [tokenPanelOpen, setTokenPanelOpen] = useState(false);
  const [cabinetMoney, setCabinetMoney] = useState<AdCabinetConfig | null>(null);
  // Отметки для массового действия. Живут отдельно от выбранной кампании:
  // «смотрю эту» и «делаю с этими» — разные намерения, и склеивать их значит
  // выполнять действие над карточкой, которую человек просто открыл почитать.
  const [checked, setChecked] = useState<Set<number>>(new Set());
  // Ссылка на контейнер списка. Нужна, чтобы пересчитывать видимое окно от
  // РЕАЛЬНОЙ позиции прокрутки, а не сбрасывать его вслепую.
  const listRef = useRef<HTMLDivElement | null>(null);
  // Категории живут в product_costs, а не в WB-таблицах, поэтому фильтруем уже
  // загруженные строки. Тот же источник, что и на остальных экранах панели —
  // иначе «Ковры» здесь и «Ковры» в РНП разошлись бы.
  const [category, setCategory] = useDashboardFilter<string>("cat", "");
  const [order, setOrder] = useDashboardFilter<"spend" | "verdict">("order", "spend", ["spend", "verdict"]);
  const { categories, byArticle } = useCategoryMap();
  const requestId = useRef(0);
  const dataKeyRef = useRef<string | null>(null);
  const elapsed = useElapsedSeconds(loading);
  const currentDataKey = cabinetId || "all";
  const activeData = dataKey === currentDataKey ? data : null;

  useEffect(() => {
    if (!ready || cabinetsLoading) return;
    if (cabinets.length === 0) {
      setLoading(false);
      setData(null);
      dataKeyRef.current = null;
      setDataKey(null);
      setError(cabinetsError || "Подключите хотя бы один активный WB-кабинет в настройках");
      return;
    }
    const requestKey = cabinetId || "all";
    if (dataKeyRef.current !== requestKey) {
      dataKeyRef.current = null;
      setDataKey(null);
      setData(null);
    }
    const controller = new AbortController();
    const current = ++requestId.current;
    let timedOut = false;
    // Дедлайн клиента был короче серверного (maxDuration = 60 у /api/adverts/list):
    // на тяжёлом кабинете человек получал отказ по запросу, который сервер бы
    // дотянул. Даём серверу доработать и ещё пять секунд на дорогу.
    const deadline = window.setTimeout(() => { timedOut = true; controller.abort(); }, 65_000);
    setLoading(true);
    setError(null);
    deploymentPinnedFetch(`/api/adverts/list?cabinet=${encodeURIComponent(cabinetId || "all")}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        return readOkApiResponse<AdvertsData>(response, "Реклама WB");
      })
      .then((body) => {
        if (current !== requestId.current) return;
        if (!body.ok) throw new Error(body.error || "Не удалось загрузить рекламу");
        setData(body);
        dataKeyRef.current = requestKey;
        setDataKey(requestKey);
      })
      .catch((cause: unknown) => {
        if (current !== requestId.current || (controller.signal.aborted && !timedOut)) return;
        setError(timedOut ? "Рекламный кабинет не ответил за 65 секунд. Повторите запрос." : cause instanceof Error ? cause.message : "Не удалось загрузить рекламу");
      })
      .finally(() => {
        window.clearTimeout(deadline);
        if (current === requestId.current) setLoading(false);
      });
    return () => { window.clearTimeout(deadline); controller.abort(); };
  }, [cabinetId, cabinets.length, cabinetsError, cabinetsLoading, ready, retryKey]);

  const baseRows = useMemo<CampaignRow[]>(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    return filterByCategory(activeData?.articles ?? [], (article) => article.art, byArticle, category)
      .flatMap((article) => article.campaigns.map((campaign) => ({ article, campaign })))
      .filter(({ article, campaign }) => {
        // Тип берём из данных WB. Раньше всё, что не cpc, считалось «единой» —
        // включая кампании, тип которых панель просто не знает.
        if (kind !== "all" && campaignPaymentKind(campaign) !== kind) return false;
        return !needle || `${article.art} ${article.nm} ${campaign.name} ${campaign.id}`.toLocaleLowerCase("ru-RU").includes(needle);
      })
      .sort((left, right) => compareAdvertCampaigns(left.campaign, right.campaign));
  }, [activeData?.articles, byArticle, category, kind, query]);

  const statusCounts = useMemo(() => STATUS_FILTERS.reduce<Record<CampaignStatusFilter, number>>((acc, filter) => {
    acc[filter.value] = filter.value === "all"
      ? baseRows.length
      : baseRows.filter(({ campaign }) => campaignStatusKind(campaign) === filter.value).length;
    return acc;
  }, { active: 0, paused: 0, archive: 0, all: 0 }), [baseRows]);

  const rows = useMemo(() => {
    const filtered = statusFilter === "all"
      ? baseRows
      : baseRows.filter(({ campaign }) => campaignStatusKind(campaign) === statusFilter);
    if (order !== "verdict") return filtered;
    // Внутри одной срочности порядок остаётся прежним — по расходу. Так
    // переключатель меняет только группировку, а не всё сразу: человек, который
    // привык к порядку списка, не теряет его целиком.
    return [...filtered].sort((left, right) => {
      const rank = (VERDICT_RANK[left.campaign.economics.action] ?? 9) - (VERDICT_RANK[right.campaign.economics.action] ?? 9);
      return rank !== 0 ? rank : compareAdvertCampaigns(left.campaign, right.campaign);
    });
  }, [baseRows, statusFilter, order]);

  // Сколько кампаний в текущем фильтре ждут решения. Число в кнопке отвечает на
  // вопрос «есть ли смысл переключаться» до того, как человек переключился.
  const needDecision = useMemo(
    () => rows.filter(({ campaign }) => campaign.economics.action !== "hold" && campaign.economics.action !== "insufficient").length,
    [rows],
  );

  /**
   * Кампания выбирается один раз и дальше держится сама.
   *
   * Раньше здесь стояло «нет в отфильтрованном списке — берём первую строку».
   * Список отсортирован по расходу, фильтр по умолчанию «Активные», и цепочка
   * получалась такая: кампанию поставили на паузу → она выпала из фильтра →
   * карточка справа молча перецелилась на самую жгущую бюджет активную
   * кампанию. Пока карточка только показывает, это раздражает. Когда в ней
   * появятся кнопки, следующий клик в том же месте экрана уйдёт по чужой
   * кампании, причём по самой дорогой из активных.
   *
   * Теперь автоматический выбор происходит ровно в одном случае: когда не
   * выбрано ничего. Выпавшая из фильтра кампания остаётся выбранной и
   * показывается отдельной строкой над списком.
   */
  useEffect(() => {
    const known = baseRows.some(({ campaign }) => campaign.id === selectedId);
    if (!known) setSelectedId(rows[0]?.campaign.id ?? null);
  }, [baseRows, rows, selectedId, setSelectedId]);

  /**
   * Окно виртуального списка сбрасывается вместе с прокруткой — и только когда
   * состав списка действительно поменялся.
   *
   * Раньше оно обнулялось при каждой смене выбранной кампании, а позиция
   * прокрутки оставалась на месте. Список держат распорки нужной высоты, и
   * пересчитывается окно только по onScroll, — поэтому клик по строке ниже
   * шестнадцатой оставлял на экране пустое белое поле, пока человек не дёрнет
   * колесо. На фильтре «Активные» (10 строк) это не проявляется вовсе, а на
   * «Все» (238) и «Пауза» (64) — всегда: ровно там, куда идут искать вчерашнего
   * сжигателя бюджета.
   */
  useEffect(() => {
    const element = listRef.current;
    if (element) element.scrollTop = 0;
    setRowWindow({ start: 0, end: Math.min(16, rows.length) });
  }, [cabinetId, statusFilter, kind, query, category, order, rows.length]);

  const singleCabinet = Boolean(cabinetId && cabinetId !== "all");

  useEffect(() => {
    if (!singleCabinet) {
      setCabinetMoney(null);
      return;
    }
    let cancelled = false;
    // Право менять деньги проверяет сервер. Полагаться на клиентский флаг
    // нельзя: пока права не загрузились, он оптимистичен — и полоса успела бы
    // мигнуть тому, кому её видеть не положено.
    deploymentPinnedFetch(`/api/adverts/config?cabinet=${cabinetId}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => { if (!cancelled) setCabinetMoney(json && !json.error ? (json as AdCabinetConfig) : null); })
      .catch(() => { if (!cancelled) setCabinetMoney(null); });
    return () => { cancelled = true; };
  }, [cabinetId, singleCabinet, retryKey]);

  useEffect(() => { setChecked(new Set()); }, [cabinetId]);

  /**
   * Кампании для разделов «Фразы и кластеры» и «Автоправила».
   *
   * Берутся из полного ответа, а НЕ из отфильтрованного списка кампаний. Иначе
   * слово, набранное в поиске слева, молча урезало бы выпадашки справа — и
   * объяснение «нет кампаний с ручной ставкой» стало бы ложью: они есть, просто
   * не подошли под поиск, о котором человек в этот момент уже не думает.
   */
  const adRows: AdCampaignRow[] = useMemo(() => (activeData?.articles ?? [])
    .flatMap((article) => article.campaigns.map((campaign) => ({ article, campaign })))
    .map(({ article, campaign }) => ({
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      bid_cpm_rub: campaign.bid_cpm_rub,
      bid_type: campaign.bid_type,
      spend_today: campaign.spend_today,
      drr: campaign.drr,
    },
    nm: article.nm,
    art: article.art,
  })), [activeData?.articles]);

  const currency = cabinetMoney?.config?.currency && cabinetMoney.config.currency !== "RUB" ? cabinetMoney.config.currency : "₽";

  const runBulk = (action: "pause" | "start") => {
    const ids = [...checked];
    if (!ids.length) return;
    const names = baseRows.filter(({ campaign }) => checked.has(campaign.id)).map(({ campaign }) => campaign.name);
    setConfirmRequest({
      actionId: action,
      subject: withPlural(ids.length, "кампания", "кампании", "кампаний"),
      detail: `${names.slice(0, 4).join(", ")}${names.length > 4 ? ` и ещё ${names.length - 4}` : ""}. Кампании обрабатываются по очереди с паузой — WB считает лимит на весь кабинет.`,
      run: async () => {
        const result = await adPost<{ success: number; failed: number; skipped: number; stoppedEarly: string | null }>(
          "/api/adverts/bulk",
          { cabinetId, advertIds: ids, action },
        );
        // Частичный успех — обычный исход пачки, и молчать о нём нельзя:
        // «готово» после трёх обработанных из сорока читается как «все сорок».
        const data = result.data;
        if (data && (data.failed > 0 || data.skipped > 0)) {
          return {
            ok: false,
            error: `Обработано ${data.success} из ${ids.length}. Не удалось: ${data.failed}${data.skipped ? `, не пробовали: ${data.skipped}` : ""}.${data.stoppedEarly ? ` ${data.stoppedEarly}` : ""}`,
          };
        }
        if (result.ok) {
          setChecked(new Set());
          setRetryKey((value) => value + 1);
        }
        return { ok: result.ok, error: result.error };
      },
    });
  };

  const selected = baseRows.find(({ campaign }) => campaign.id === selectedId) ?? null;
  // Выбранная кампания есть, но текущий фильтр её не показывает. Молча прятать
  // строку нельзя: человек видит карточку справа и не понимает, где её строка.
  const selectedOutsideFilter = selected != null && !rows.some(({ campaign }) => campaign.id === selectedId);
  const selectedStatus = selected ? campaignStatusMeta(selected.campaign) : null;
  const selectedYesterday = selected?.campaign.yesterday ?? emptyDaySummary(activeData?.yest, true);
  const selectedTodayOpen = selected?.campaign.today_open ?? emptyDaySummary(activeData?.today, false);
  const SelectedStatusIcon = selectedStatus?.Icon ?? Megaphone;
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
        description={activeData
          ? `${activeData.count} активных кампаний · расход сегодня ${rub(activeData.spend_today_total)}`
            // Расход кампании без списка товаров не ложится ни на один артикул.
            // Молчать об этом нельзя: итог сверху перестал бы сходиться с
            // суммой строк, и это выглядело бы как ошибка счёта.
            + (activeData.spend_unattributed?.today
              ? `, из них ${rub(activeData.spend_unattributed.today)} без привязки к товару`
              : "")
          : "Кампании, ставки, расписание и статистика"}
        actions={
          <>
          {singleCabinet ? (
            <button type="button" onClick={() => setTokenPanelOpen((open) => !open)} title="Проверить или заменить ключ Продвижения" className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 shadow-sm transition-colors hover:bg-slate-50 sm:min-h-8">
              <KeyRound className="h-3.5 w-3.5 text-slate-400" /> Ключ
            </button>
          ) : null}
          <button type="button" onClick={() => setRetryKey((value) => value + 1)} disabled={loading} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60 sm:min-h-8">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="h-3.5 w-3.5" />} Обновить
          </button>
          </>
        }
      />

      {/*
        Две полосы, а не одна. Полоса А считается из того же запроса, что и
        список, поэтому работает в любом режиме и у любой роли. Полоса Б живёт
        отдельным запросом и появляется только там, где сервер подтвердил право
        менять деньги кабинета. Смешать их значило бы либо потерять первую в
        режиме «все кабинеты», либо показать вторую тому, кому нельзя.
      */}
      {activeData ? (
        <div className="flex flex-wrap items-center gap-2 px-2 pt-3 text-[11px] sm:px-6">
          <span className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 font-semibold text-slate-600 shadow-sm">
            <WalletCards className="h-3.5 w-3.5 text-slate-400" />
            Расход сегодня {rub(activeData.spend_today_total)}
            {activeData.spend_yest_total ? ` · вчера ${rub(activeData.spend_yest_total)}` : ""}
          </span>
          {activeData.balance != null ? (
            <span className={`rounded-lg px-2 py-1 font-semibold shadow-sm ${activeData.balance < activeData.cap_rub ? "bg-amber-50 text-amber-800" : "bg-white text-slate-600"}`}>
              Баланс продвижения {rub(activeData.balance)}
              {activeData.balance < activeData.cap_rub ? ` · ниже порога ${rub(activeData.cap_rub)}` : ""}
            </span>
          ) : null}
          {cabinetMoney?.token?.sandbox ? (
            <span className="rounded-lg bg-violet-100 px-2 py-1 font-bold text-violet-700">ПЕСОЧНИЦА — действия не стоят денег</span>
          ) : null}
          {cabinetMoney?.money ? (
            <span className="rounded-lg bg-white px-2 py-1 font-semibold text-slate-600 shadow-sm">
              Счёт {adMoney(cabinetMoney.money.account, currency)} · Взаимозачёт {adMoney(cabinetMoney.money.net, currency)}
              {cabinetMoney.money.bonus == null ? "" : ` · Бонусы ${adMoney(cabinetMoney.money.bonus, currency)}`}
            </span>
          ) : null}
          {cabinetMoney?.depositAllowance ? (
            <span className="rounded-lg bg-white px-2 py-1 font-semibold text-slate-600 shadow-sm">
              Лимит пополнений: сегодня {adMoney(cabinetMoney.depositAllowance.spentToday, currency)} из {adMoney(cabinetMoney.depositAllowance.maxPerDay, currency)}
            </span>
          ) : null}
          {!singleCabinet ? (
            <span className="rounded-lg bg-slate-100 px-2 py-1 font-semibold text-slate-500">
              Деньги кабинета и действия — выберите один кабинет
            </span>
          ) : null}
        </div>
      ) : null}

      {singleCabinet && tokenPanelOpen ? (
        <div className="px-2 pt-3 sm:px-6">
          <AdTokenPanel cabinetId={cabinetId as string} onClose={() => setTokenPanelOpen(false)} onSaved={() => setRetryKey((value) => value + 1)} />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1.5 px-2 pt-3 text-[11px] sm:px-6">
        {MODULE_VIEWS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setView(item.value)}
            disabled={item.value !== "campaigns" && !singleCabinet}
            title={item.value !== "campaigns" && !singleCabinet ? "Доступно при выбранном кабинете" : undefined}
            className={`min-h-8 rounded-lg px-2.5 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${view === item.value ? "bg-slate-800 text-white" : "bg-white text-slate-600 shadow-sm hover:bg-slate-50"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {view !== "campaigns" && singleCabinet ? (
        <div className="px-2 py-3 sm:px-6">
          {view === "phrases" ? <AdClustersTab cabinetId={cabinetId as string} rows={adRows} currency={currency} onAsk={setConfirmRequest} /> : null}
          {view === "rules" ? <AdRulesTab cabinetId={cabinetId as string} rows={adRows} currency={currency} onAsk={setConfirmRequest} /> : null}
          {view === "log" ? <AdJournalTab cabinetId={cabinetId as string} /> : null}
        </div>
      ) : null}

      <div className={`${view === "campaigns" ? "grid" : "hidden"} min-h-[calc(100vh-110px)] gap-3 px-2 py-3 sm:px-6 lg:grid-cols-[360px_minmax(0,1fr)]`}>
        <section className="flex min-h-[480px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="border-b border-slate-200 p-3">
            <label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100 sm:min-h-8">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="артикул, название или #id" className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-slate-400" />
            </label>
            <div className="mt-2 flex items-center gap-1 text-[10px]">
              <span className="mr-1 text-slate-400">порядок:</span>
              {([["spend", "по расходу"], ["verdict", "сначала требующие решения"]] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setOrder(value)}
                  className={`min-h-7 rounded-lg px-2 font-semibold transition-colors ${order === value ? "bg-slate-800 text-white" : "bg-slate-50 text-slate-600 hover:bg-slate-100"}`}
                >
                  {label}
                  {value === "verdict" && needDecision > 0 ? <span className="ml-1 rounded bg-white/20 px-1">{needDecision}</span> : null}
                </button>
              ))}
            </div>
            {categories.length > 0 ? (
              <div className="mt-2">
                <CategoryFilter categories={categories} value={category} onChange={setCategory} />
              </div>
            ) : null}
            <div className="mt-2 flex items-center gap-1 text-[10px]">
              <span className="mr-1 text-slate-400">тип:</span>
              {([['all', 'Все'], ['cpc', 'CPC'], ['cpm', 'CPM'], ['unknown', 'Оплата неизвестна']] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setKind(value)} className={`min-h-8 rounded-lg px-2.5 font-semibold transition-colors ${kind === value ? "bg-slate-800 text-white" : "bg-violet-50 text-violet-700 hover:bg-violet-100"}`}>{label}</button>
              ))}
              <span className="ml-auto tabular-nums text-slate-400">{rows.length} из {baseRows.length} РК</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px]">
              <span className="mr-1 text-slate-400">статус:</span>
              {STATUS_FILTERS.map(({ value, label, Icon }) => (
                <button key={value} type="button" onClick={() => setStatusFilter(value)} className={`inline-flex min-h-8 items-center gap-1 rounded-lg px-2 font-semibold transition-colors ${statusFilter === value ? "bg-violet-600 text-white shadow-sm" : "bg-slate-50 text-slate-600 hover:bg-slate-100"}`}>
                  <Icon className="h-3 w-3" />
                  {label}
                  <span className={`rounded px-1.5 py-0.5 text-[9px] tabular-nums ${statusFilter === value ? "bg-white/20 text-white" : "bg-white text-slate-400"}`}>{statusCounts[value]}</span>
                </button>
              ))}
            </div>
          </div>

          {error && activeData ? (
            <div className="mx-3 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-900">
              {error} Показан последний готовый список кампаний.
            </div>
          ) : null}

          {loading && !activeData ? <div className="p-3"><LoadingBanner seconds={elapsed} hint={`реклама · ${activeCabinet?.name ?? "все кабинеты"}`} /><SkeletonCards count={5} /></div> : error && !activeData ? <div className="p-3"><WbErrorState message={error} onRetry={() => setRetryKey((value) => value + 1)} /></div> : rows.length === 0 && !selectedOutsideFilter ? <div className="p-3"><WbEmptyState>Кампаний по выбранному фильтру нет.</WbEmptyState></div> : (
            <>
            {checked.size > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 border-b border-violet-200 bg-violet-50 px-3 py-2 text-[11px]">
                <span className="font-semibold text-violet-800">Отмечено {checked.size}</span>
                <button
                  type="button"
                  onClick={() => runBulk("pause")}
                  className="min-h-7 rounded-lg border border-amber-300 bg-white px-2 font-semibold text-amber-800 transition-colors hover:bg-amber-50"
                >
                  Пауза
                </button>
                <button
                  type="button"
                  onClick={() => runBulk("start")}
                  className="min-h-7 rounded-lg border border-emerald-300 bg-white px-2 font-semibold text-emerald-700 transition-colors hover:bg-emerald-50"
                >
                  Запустить
                </button>
                <button type="button" onClick={() => setChecked(new Set())} className="ml-auto text-violet-600 underline-offset-2 hover:underline">
                  снять
                </button>
              </div>
            ) : null}
            <div ref={listRef} className="min-h-0 flex-1 overflow-auto overscroll-contain" onScroll={(event) => updateWindow(event.currentTarget)}>
              {selectedOutsideFilter && selected ? (
                <div className="border-b border-violet-200 bg-violet-50/70 px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${campaignStatusMeta(selected.campaign).dot}`} />
                    <span className="truncate text-[11px] font-semibold text-slate-700">{selected.campaign.name}</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-[9px] text-violet-700">
                    <span className="truncate">{selected.article.art} · открыта справа, но не проходит фильтр «{STATUS_FILTERS.find((filter) => filter.value === statusFilter)?.label ?? statusFilter}»</span>
                    <button
                      type="button"
                      onClick={() => setStatusFilter(campaignStatusKind(selected.campaign))}
                      className="shrink-0 rounded border border-violet-300 px-1.5 py-0.5 font-semibold text-violet-700 transition-colors hover:bg-violet-100"
                    >
                      показать
                    </button>
                  </div>
                </div>
              ) : null}
              {rowWindow.start > 0 ? <div aria-hidden="true" style={{ height: rowWindow.start * ROW_HEIGHT }} /> : null}
              {rows.slice(rowWindow.start, rowWindow.end).map(({ article, campaign }) => {
                const active = selectedId === campaign.id;
                const status = campaignStatusMeta(campaign);
                const StatusIcon = status.Icon;
                return (
                  <div key={campaign.id} className={`flex h-[76px] items-center border-b border-slate-100 transition-colors ${active ? "bg-violet-50" : "hover:bg-slate-50"}`}>
                    {singleCabinet && cabinetMoney ? (
                      <label className="flex h-full shrink-0 cursor-pointer items-center pl-2 pr-1" title="Отметить для массового действия">
                        <input
                          type="checkbox"
                          checked={checked.has(campaign.id)}
                          onChange={() => setChecked((prev) => {
                            const next = new Set(prev);
                            if (next.has(campaign.id)) next.delete(campaign.id); else next.add(campaign.id);
                            return next;
                          })}
                          className="h-3.5 w-3.5 accent-violet-600"
                        />
                      </label>
                    ) : null}
                  <button type="button" onClick={() => setSelectedId(campaign.id)} className="flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500">
                    <WbProductImage nm={article.nm} src={article.photo} loading="lazy" className="h-10 w-10 shrink-0 rounded-lg border border-slate-100 bg-slate-50 object-cover" />
                    <div className="min-w-0 flex-1 pr-2">
                      {/*
                        Три строки вместо двух, и порядок другой: артикул с
                        вердиктом сверху, признаки кампании ниже, имя последним.
                        Раньше имя и артикул делили одну строку с числами
                        справа — на кабинете NORVIA имя обрезалось до буквы «Р»,
                        а номенклатура до «n.». Обрезок в две буквы это не
                        сокращение, а шум: место он занимает, а прочитать нельзя.
                        Артикул опознаёт товар, вердикт говорит, что с ним делать —
                        эта пара и стоит первой.
                      */}
                      <div className="flex items-center gap-1.5">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.dot}`} />
                        <StatusIcon className="h-3 w-3 shrink-0 text-slate-400" />
                        <span className="shrink-0 text-[11px] font-bold text-slate-800">{article.art}</span>
                        {VERDICT_BADGE[campaign.economics.action] ? (
                          <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-bold ${VERDICT_BADGE[campaign.economics.action]!.className}`}>
                            {VERDICT_BADGE[campaign.economics.action]!.label}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1 text-[9px] text-slate-400">
                        <span className={`shrink-0 rounded px-1 py-0.5 ${PAYMENT_BADGE[campaignPaymentKind(campaign)].className}`}>{PAYMENT_BADGE[campaignPaymentKind(campaign)].label}</span>
                        <span className={`shrink-0 rounded px-1 py-0.5 ${BID_BADGE[campaignBidKind(campaign)].className}`}>{BID_BADGE[campaignBidKind(campaign)].label}</span>
                        {campaign.stats_stale ? <span title={campaign.stats_synced_at || "Статистика ещё не загружена"} className="shrink-0 rounded bg-rose-50 px-1 py-0.5 font-semibold text-rose-700">данные {campaign.stats_age_hours == null ? "нет" : `${campaign.stats_age_hours} ч.`}</span> : null}
                      </div>
                      <div className="mt-0.5 truncate text-[9px] text-slate-400" title={campaign.name}>{campaign.name}</div>
                    </div>
                    <div className="w-[128px] shrink-0 text-right">
                      <div title={closedDrrTitle(campaign) + ` · период ${campaign.metrics_period_7_closed.date_from} — ${campaign.metrics_period_7_closed.date_to}`} className={`inline-block rounded border px-1.5 py-0.5 text-[9px] font-semibold tabular-nums ${closedDrrTone(campaign)}`}>ДРР 7д {closedDrrLabel(campaign)}</div>
                      <div className="mt-0.5 text-[9px] font-semibold tabular-nums text-slate-800">{campaign.bid_cpm_rub == null ? "ставка —" : rub(campaign.bid_cpm_rub)} · сег. {rub(campaign.spend_today)}</div>
                      <div className="mt-0.5 text-[9px] tabular-nums text-slate-500">7 дн. {rub(campaign.spent_7_closed)}</div>
                      {article.spent_sku_7_closed == null
                        ? <div title="Разбивка расхода по артикулам за период не собрана" className="text-[9px] tabular-nums text-slate-400">по артикулу —</div>
                        : Math.round(article.spent_sku_7_closed) !== Math.round(campaign.spent_7_closed)
                          ? <div title="По этому артикулу тратит не только эта кампания" className="text-[9px] tabular-nums text-violet-700">по артикулу {rub(article.spent_sku_7_closed)}</div>
                          : null}
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                  </button>
                  </div>
                );
              })}
              {rowWindow.end < rows.length ? <div aria-hidden="true" style={{ height: (rows.length - rowWindow.end) * ROW_HEIGHT }} /> : null}
            </div>
            </>
          )}
        </section>

        <section className="min-w-0 rounded-xl border border-dashed border-slate-200 bg-white">
          {!selected ? (
            <div className="grid min-h-[420px] place-items-center px-6 text-center text-sm leading-5 text-slate-400">Выберите кампанию слева — здесь откроется её карточка: расписание, статистика и разбор.</div>
          ) : (
            <div className="p-3 sm:p-5">
              <div className="flex items-start gap-3 border-b border-slate-100 pb-4">
                <WbProductImage nm={selected.article.nm} src={selected.article.photo} loading="eager" className="h-14 w-14 shrink-0 rounded-xl border border-slate-100 bg-slate-50 object-cover" />
                <div className="min-w-0"><div className="text-sm font-bold text-slate-800">{selected.campaign.name}</div><div className="mt-1 text-[11px] text-slate-400">{selected.article.art} · nm {selected.article.nm} · РК #{selected.campaign.id}</div></div>
                <div className="ml-auto flex flex-col items-end gap-1">{selectedStatus ? <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${selectedStatus.tone}`}><SelectedStatusIcon className="h-3 w-3" />{selectedStatus.label}</span> : null}{selected.campaign.stats_stale ? <span className="rounded bg-rose-50 px-2 py-1 text-[9px] font-semibold text-rose-700">статистика устарела</span> : null}</div>
              </div>

              <div className="grid grid-cols-2 gap-2 py-4 sm:grid-cols-4">
                {[
                  ["Расход · 14 дней, атрибуция WB", rub(selected.campaign.spent_14)],
                  ["Выручка · 14 дней, атрибуция WB", rub(selected.campaign.ad_revenue_14)],
                  ["ДРР / break-even · 14 дней, атрибуция WB", `${pct(selected.campaign.economics.currentDrr)} / ${pct(selected.campaign.economics.breakEvenDrr)}`],
                  ["Прибыль после рекламы", rub(selected.campaign.economics.profitAfterAds)],
                  ["ROAS / break-even", `${selected.campaign.economics.currentRoas ?? "—"}× / ${selected.campaign.economics.breakEvenRoas ?? "—"}×`],
                  ["Запас", selected.campaign.economics.daysCover == null
                    ? "—"
                    : `${selected.campaign.economics.daysCover} дн.${STOCK_RISK_NOTE[selected.campaign.economics.stockRisk] ?? ""}`],
                  ["Ставка CPM", rub(selected.campaign.bid_cpm_rub)],
                  ["Уверенность", `${selected.campaign.economics.confidencePct}%`],
                ].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3"><div className="text-[9px] uppercase tracking-wide text-slate-400">{label}</div><div className="mt-1 text-sm font-semibold tabular-nums text-slate-700">{value}</div></div>)}
              </div>

              <p className="mb-3 text-[10px] leading-4 text-slate-500">ДРР рекламы не равно ДРР к заказам во Воронке: в Рекламе знаменатель — только выручка, атрибутированная рекламой WB.</p>

              <section className="mb-3 rounded-xl border border-violet-100 bg-violet-50/40 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-xs font-bold text-slate-800">Вчера · полный день</h2>
                    <p className="mt-1 text-[10px] leading-4 text-slate-500">{selectedYesterday.date} · реклама РК + товарная воронка SKU · {syncLabel(selectedYesterday)}</p>
                  </div>
                  <span className="rounded-full border border-emerald-200 bg-white px-2 py-1 text-[9px] font-semibold text-emerald-700">закрытый день</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
                  {[
                    ["Показы РК", int(selectedYesterday.views)],
                    ["Клики РК", int(selectedYesterday.clicks)],
                    ["CTR РК", pct(selectedYesterday.ctr)],
                    ["Расход РК", rub(selectedYesterday.spend)],
                    ["Корзины SKU", int(selectedYesterday.carts)],
                    ["Заказы SKU, шт", int(selectedYesterday.orders_count)],
                    ["Выручка РК", rub(selectedYesterday.attributed_revenue)],
                    ["ДРР РК", pct(selectedYesterday.attributed_drr)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-white/80 bg-white p-2.5 shadow-[0_1px_2px_rgba(124,58,237,0.06)]">
                      <div className="text-[9px] uppercase tracking-wide text-slate-400">{label}</div>
                      <div className="mt-1 text-sm font-bold tabular-nums text-slate-800">{value}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 grid gap-2 rounded-lg border border-slate-200 bg-white/75 p-2 text-[10px] leading-4 text-slate-500 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div>
                    <span className="font-semibold text-slate-700">Сегодня · незакрытый день:</span> {selectedTodayOpen.date} · расход РК {rub(selectedTodayOpen.spend)} · клики {int(selectedTodayOpen.clicks)} · заказы SKU {int(selectedTodayOpen.orders_count)} · выручка РК {rub(selectedTodayOpen.attributed_revenue)}
                  </div>
                  <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-500">не сравниваем с полным вчера</span>
                </div>
                <p className="mt-2 text-[10px] leading-4 text-slate-500">Корзины и заказы — из товарной воронки SKU. Расход, клики, показы, выручка и ДРР — из статистики рекламной кампании WB.</p>
              </section>

              <section className={`mb-3 rounded-xl border p-3 ${actionTone(selected.campaign.economics.action)}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><div className="text-[9px] font-semibold uppercase tracking-wide opacity-70">Рекомендация</div><div className="mt-1 text-sm font-bold">{actionLabel(selected.campaign.economics)}</div></div>
                  <div className="text-right"><div className="text-[9px] opacity-70">Ожидаемый эффект за 14 дней</div><div className="mt-1 text-sm font-bold tabular-nums">{rub(selected.campaign.economics.expectedProfitEffect)}</div></div>
                </div>
                <p className="mt-2 text-[11px] leading-5">{selected.campaign.economics.reason}</p>
                {!selected.campaign.attribution_compatible && (
                  <p className="mt-1 text-[10px] font-semibold">
                    {selected.campaign.nm_count != null && selected.campaign.nm_count > 1
                      ? `В кампании ${selected.campaign.nm_count} артикулов — панель не может отнести выручку к одному, поэтому рекомендацию на повышение ставки не даёт вовсе.`
                      : "Выручка кампании расходится с выручкой товара за месяц — рекомендация понижена по уверенности."}
                  </p>
                )}
              </section>

              <div className="rounded-xl border border-slate-200 p-3"><div className="mb-2 flex items-center justify-between"><h2 className="text-xs font-bold text-slate-700">Расход по дням</h2><span className="text-[10px] text-slate-400">последние 14 дней</span></div><Sparkline values={selected.campaign.days.map((day) => day.spend)} /></div>

              <section className="mt-3 rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2"><h2 className="text-xs font-bold text-slate-700">До / после изменения ставки</h2>{selected.campaign.last_change && <span className="text-[9px] text-slate-400">{new Date(selected.campaign.last_change.created_at).toLocaleDateString("ru-RU")}</span>}</div>
                {selected.campaign.comparison ? <div className="mt-3 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-slate-50 p-2"><div className="text-[9px] text-slate-400">До</div><div className="mt-1 font-semibold">ДРР {pct(selected.campaign.comparison.before.drr)}</div><div className="text-[9px] text-slate-400">{selected.campaign.comparison.before.days} дн.</div></div><div className="rounded-lg bg-violet-50 p-2"><div className="text-[9px] text-violet-500">Изменение</div><div className="mt-1 font-semibold text-violet-700">{selected.campaign.last_change?.old_bid ?? "—"} → {selected.campaign.last_change?.new_bid ?? "—"}</div><div className="text-[9px] text-violet-500">ставка</div></div><div className="rounded-lg bg-slate-50 p-2"><div className="text-[9px] text-slate-400">После</div><div className="mt-1 font-semibold">ДРР {pct(selected.campaign.comparison.after.drr)}</div><div className={`text-[9px] ${Number(selected.campaign.comparison.drrDelta) <= 0 ? "text-emerald-600" : "text-rose-600"}`}>{selected.campaign.comparison.drrDelta == null ? "—" : `${selected.campaign.comparison.drrDelta > 0 ? "+" : ""}${selected.campaign.comparison.drrDelta} п.п.`}</div></div></div> : <p className="mt-2 text-[10px] leading-4 text-slate-400">{beforeAfterReason(selected.campaign)}</p>}
              </section>

              <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[640px] border-collapse text-[10px]">
                  <thead><tr className="h-8 bg-slate-50 text-slate-500"><th className="px-3 text-left">Дата</th><th className="px-3 text-right">Показы</th><th className="px-3 text-right">Клики</th><th className="px-3 text-right">CTR</th><th className="px-3 text-right">Расход</th><th className="px-3 text-right">Атриб. выручка</th><th className="px-3 text-right">ДРР</th></tr></thead>
                  <tbody>{selected.campaign.days.slice().reverse().map((day) => <tr key={day.ts} className="h-8 border-t border-slate-100"><td className="px-3 text-slate-500">{day.ts}</td><td className="px-3 text-right tabular-nums">{day.views.toLocaleString("ru-RU")}</td><td className="px-3 text-right tabular-nums">{day.clicks.toLocaleString("ru-RU")}</td><td className="px-3 text-right tabular-nums">{pct(day.views > 0 ? (day.clicks / day.views) * 100 : null)}</td><td className="px-3 text-right font-medium tabular-nums">{rub(day.spend)}</td><td className="px-3 text-right tabular-nums">{rub(day.orders)}</td><td className="px-3 text-right tabular-nums">{pct(day.orders > 0 ? (day.spend / day.orders) * 100 : null)}</td></tr>)}</tbody>
                </table>
                {selected.campaign.days.length === 0 ? <div className="border-t border-slate-100 px-3 py-8 text-center text-xs text-slate-400">Посуточная статистика ещё не синхронизирована.</div> : null}
              </div>

              {singleCabinet && cabinetMoney ? (
                <AdActionsPanel
                  cabinetId={cabinetId as string}
                  campaign={{
                    id: selected.campaign.id,
                    name: selected.campaign.name,
                    status: selected.campaign.status,
                    bid_cpm_rub: selected.campaign.bid_cpm_rub,
                    bid_type: selected.campaign.bid_type,
                    nm: selected.article.nm,
                    art: selected.article.art,
                    breakEvenDrr: selected.campaign.economics.breakEvenDrr,
                    currentDrr: selected.campaign.economics.currentDrr,
                    profitAfterAds: selected.campaign.economics.profitAfterAds,
                  }}
                  cabinetMoney={cabinetMoney}
                  currency={currency}
                  onAsk={setConfirmRequest}
                  onDone={() => setRetryKey((value) => value + 1)}
                />
              ) : (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                  <WalletCards className="h-4 w-4 shrink-0" />
                  {singleCabinet
                    ? "Действия недоступны: у вас нет права менять деньги в этом кабинете либо не прочитался ключ Продвижения."
                    : "Действия доступны при выбранном кабинете — в режиме «Все кабинеты» непонятно, куда их отправлять."}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <ConfirmAction request={confirmRequest} onClose={() => setConfirmRequest(null)} onDone={() => setRetryKey((value) => value + 1)} />
    </div>
  );
}
