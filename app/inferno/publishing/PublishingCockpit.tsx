"use client";

import {
  AlertTriangle,
  BadgeCheck,
  Ban,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Copy,
  Inbox,
  LayoutGrid,
  Loader2,
  Lock,
  LucideIcon,
  MonitorSmartphone,
  PlayCircle,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Users,
  View,
  WifiOff,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type StreamKey = "all" | "product" | "manya";
type DemoState = "live" | "loading" | "empty" | "partial" | "error" | "ratelimited" | "banned" | "success" | "salvo";
type ScreenKey = "overview" | "bank" | "calendar" | "fleet" | "runs" | "metrics" | "channels" | "alerts";

type CockpitData = {
  ok: boolean;
  configured: boolean;
  mode: "boot" | "partial" | "full";
  stream: StreamKey;
  generatedAt: string;
  warnings: string[];
  readEvidence: {
    recipesVisible: number;
    generatedVideosVisible: number;
    publicationsVisible: number;
    metricsVisible: number;
    targetsVisible: number;
  };
  coverage: {
    bank: boolean;
    calendar: boolean;
    fleet: boolean;
    runs: boolean;
    metrics: boolean;
    channels: boolean;
    alerts: boolean;
  };
  worker: {
    online: boolean;
    state: "unknown" | "alive" | "stale" | "dead";
    source: string;
    lastSeen: string | null;
    currentTask: string | null;
    branch: string | null;
    diagnostics: { issue?: string; detail?: string; next_step?: string } | null;
  };
  overview: {
    tiles: Array<{ id: string; label: string; value: number; delta: number; targetScreen: string; spark: number[] }>;
    liveRuns: Array<{ id: string; platform: string; account: string; article: string; stage: string; timerSec: number | null; status: string; attemptLabel: string | null }>;
    attention: Array<{ id: string; severity: "warn" | "err"; title: string; detail: string; targetScreen: string }>;
    health: Array<{ key: string; label: string; count: number; color: string }>;
  };
  improvementLoop: {
    ready: boolean;
    niche: string | null;
    winners7d: number;
    winnerPresets: number;
    learningHints: string;
    nextStep: string;
  };
  bank: Array<{ id: string; recipeId: number; article: string; title: string; niche: string; format: string; otkScore: number | null; status: string; stream: StreamKey; published: string[]; needsUniqueVariant: boolean; targetPlatform: string; outputUrl: string | null; updatedAt: string | null }>;
  calendar: Array<{ id: string; day: string; group: string; platform: string; article: string; state: string; time: string | null; complianceLocked: boolean }>;
  fleet: Array<{ id: string; handle: string; platform: string; stream: StreamKey; health: string; warmup: string; proxyKind: string; proxySid: string | null; cap: number | null; posts: number | null; lastPost: string | null; box: string; session: boolean | null; profileId: string | null; banEvidence: string | null; complianceStatus: string | null }>;
  runs: Array<{ id: string; recipeId: number; publicationId: string | null; platform: string; account: string; article: string; stage: string; timerSec: number | null; progress: number | null; reason: string | null; attemptLabel: string | null; publishedUrl: string | null; externalId: string | null; box: string; status: string }>;
  metrics: Array<{ id: string; recipeId: number; publicationId: string | null; externalPostId: string | null; platform: string; article: string; views: number; watch: number | null; saves: number | null; orders: number | null; revenue: number | null; status: string; stream: StreamKey; curve: number[]; postedAt: string | null }>;
  channels: Array<{ id: string; name: string; platform: string; transport: "api" | "browser" | "unconfirmed"; runsOn: string; status: string; accounts: number; alerts: number; publishEnabled: boolean; metricsEnabled: boolean }>;
  alerts: Array<{ id: string; kind: string; severity: "warn" | "err"; title: string; account: string; channel: string; time: string | null; evidence: string; action: string; stream: StreamKey }>;
};

type StatusData = {
  ok: boolean;
  configured: boolean;
  ready?: boolean;
  pending?: string[];
  publication_wave1?: {
    supabase_read: boolean;
    supabase_write: boolean;
    pinterest_token: boolean;
    telegram_bot: boolean;
    telegram_chat: boolean;
    tables: {
      factory_publications: boolean;
      factory_distribution_targets: boolean;
      post_metrics: boolean;
      content_assets: boolean;
    };
  };
};

type LearningData = {
  ok: boolean;
  configured: boolean;
  days?: number;
  niche?: string | null;
  signals?: {
    total?: number;
    by_event?: Record<string, number>;
    top_reject?: Array<{ reason: string; n: number }>;
  };
  hooks_by_niche?: Array<{
    niche: string;
    count: number;
    top: Array<{ hook: string; score: number; note: string }>;
  }>;
  winner_presets?: Array<{
    id: number | string;
    niche: string;
    format_type: string;
    win_note: string;
    nodes_count: number;
    source_recipe_id: number | null;
    created_at: string;
  }>;
  winners?: Array<{
    name: string;
    niche: string;
    learnings?: { hook?: string; format?: string; views?: number; note?: string } | null;
    winner_at: string;
    url?: string | null;
  }>;
};

type Toast = { id: number; kind: "ok" | "err" | "info"; text: string };
type PublishFormState = {
  platform: "pinterest" | "telegram";
  caption: string;
  hashtags: string;
  boardId: string;
  coverUrl: string;
  chatId: string;
  channelUsername: string;
};

type MarketLoopFormState = {
  mode: "pull_live" | "manual";
  views: string;
  watchRate: string;
  saves: string;
  orders: string;
  revenue: string;
};

type MarketLoopContext = {
  recipeId: number;
  publicationId: string | null;
  externalPostId: string | null;
  platform: string;
  article: string;
};

const EMPTY_IMPROVEMENT_LOOP: CockpitData["improvementLoop"] = {
  ready: false,
  niche: null,
  winners7d: 0,
  winnerPresets: 0,
  learningHints: "",
  nextStep: "Пока нет winner-метрик, чтобы замкнуть improvement loop на следующую генерацию",
};

const EMPTY_READ_EVIDENCE: CockpitData["readEvidence"] = {
  recipesVisible: 0,
  generatedVideosVisible: 0,
  publicationsVisible: 0,
  metricsVisible: 0,
  targetsVisible: 0,
};

const TABS: Array<{ id: ScreenKey; label: string; subtitle: string; icon: LucideIcon }> = [
  { id: "overview", label: "Обзор", subtitle: "пульс всей системы", icon: Sparkles },
  { id: "bank", label: "Очередь / Банк", subtitle: "готовый контент и черновики", icon: Inbox },
  { id: "calendar", label: "Календарь", subtitle: "каденс и слоты", icon: CalendarDays },
  { id: "fleet", label: "Флот аккаунтов", subtitle: "прокси · прогрев · здоровье", icon: Users },
  { id: "runs", label: "Прогоны", subtitle: "живой монитор постинга", icon: PlayCircle },
  { id: "metrics", label: "Метрики и победители", subtitle: "петля V5 · порог 5000", icon: BarChart3 },
  { id: "channels", label: "Каналы", subtitle: "адаптеры и комплаенс", icon: BadgeCheck },
  { id: "alerts", label: "Тревоги", subtitle: "список дел по сбоям", icon: ShieldAlert },
];

function workerLabel(state: CockpitData["worker"]["state"], online: boolean) {
  if (online) return "online";
  if (state === "alive") return "ready";
  if (state === "stale") return "stale";
  if (state === "dead") return "offline";
  return "unknown";
}

function channelStatusLabel(status: string) {
  if (status === "api-configured") return "api ready";
  if (status === "token-missing") return "token missing";
  if (status === "browser-session-ok") return "session ok";
  if (status === "session-dead") return "session dead";
  if (status === "compliance-block") return "compliance block";
  if (status === "transport-unconfirmed") return "unconfirmed";
  return status;
}

function transportLabel(transport: CockpitData["channels"][number]["transport"]) {
  if (transport === "api") return "API";
  if (transport === "browser") return "Browser";
  return "TBD";
}

function capabilityLabel(channel: CockpitData["channels"][number]) {
  return channel.metricsEnabled ? "publish + analytics" : "publish only";
}

function fmtNumber(value: number | null | undefined) {
  return new Intl.NumberFormat("ru-RU").format(Number(value || 0));
}

function fmtPct(value: number | null | undefined) {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
}

function fmtViewsCompact(value: number | null | undefined) {
  const num = Number(value || 0);
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return fmtNumber(num);
}

function fmtCompactMoney(value: number | null | undefined) {
  const num = Number(value || 0);
  if (!num) return "0 ₽";
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M ₽`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k ₽`;
  return `${fmtNumber(num)} ₽`;
}

function fmtAgo(iso: string | null) {
  if (!iso) return "—";
  const diff = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (diff < 1) return "только что";
  if (diff < 60) return `${diff}м назад`;
  const hours = Math.round(diff / 60);
  if (hours < 24) return `${hours}ч назад`;
  return `${Math.round(hours / 24)}д назад`;
}

function fmtTimer(seconds: number | null) {
  if (seconds == null) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function sparkPath(values: number[]) {
  if (!values.length) return "";
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(1, max - min);
  return values.map((value, index) => {
    const x = (index / Math.max(1, values.length - 1)) * 64;
    const y = 20 - ((value - min) / range) * 18;
    return `${index === 0 ? "M" : "L"}${x},${y}`;
  }).join(" ");
}

function curveBars(values: number[]) {
  const max = Math.max(...values, 1);
  return values.map((value, index) => (
    <div
      key={`${index}-${value}`}
      className="pc-curve-bar"
      style={{ height: `${Math.max(8, (value / max) * 42)}px` }}
    />
  ));
}

function bankPosterTone(item: CockpitData["bank"][number]) {
  if (item.niche === "cosmetics") return "teal";
  if (item.niche === "clothing") return "olive";
  if (item.niche === "toys") return "amber";
  if (item.stream === "manya") return "teal";
  return "olive";
}

function fleetHealthLabel(health: string) {
  if (health === "active") return "active";
  if (health === "warming") return "warming";
  if (health === "banned") return "banned";
  if (health === "needs-login") return "needs login";
  if (health === "captcha") return "captcha";
  if (health === "cooling") return "cooling";
  return health;
}

function warmupLabel(value: string) {
  if (value === "active") return "hot";
  if (value === "warming") return "3/7";
  if (value === "cold") return "cold";
  if (value === "cooling") return "cooling";
  if (value === "banned") return "blocked";
  return value;
}

function warmupProgress(value: string) {
  if (value === "active") return 1;
  if (value === "warming") return 0.45;
  if (value === "cooling") return 0.2;
  if (value === "cold") return 0.1;
  return 0;
}

function bankStatusLabel(item: CockpitData["bank"][number]) {
  if (item.status === "scheduled") return "В расписании";
  if (item.status === "queued") return "В очереди";
  if (item.published.length > 0) return "Готово";
  if (item.needsUniqueVariant) return "Придержан";
  return "Готово";
}

function metricStatusLabel(status: string) {
  if (status === "winner") return "Победитель";
  if (status === "fresh") return "Свежие";
  if (status === "salvageable") return "Спасаемо";
  if (status === "stale") return "Устарело";
  return status;
}

function metricThumbTone(metric: CockpitData["metrics"][number]) {
  if (metric.platform === "telegram") return "teal";
  if (metric.platform === "pinterest") return "amber";
  return metric.stream === "manya" ? "rose" : "olive";
}

function statusTone(status: string) {
  if (status === "winner" || status === "published" || status === "active" || status === "api-configured" || status === "browser-session-ok") return "ok";
  if (status === "failed" || status === "banned" || status === "needs-login" || status === "token-missing" || status === "session-dead" || status === "err") return "err";
  return "warn";
}

function degradedLabel(screen: "bank" | "calendar" | "fleet" | "runs" | "metrics") {
  if (screen === "bank") return "банк контента";
  if (screen === "calendar") return "календарь";
  if (screen === "fleet") return "флот аккаунтов";
  if (screen === "runs") return "прогоны публикации";
  return "рыночные метрики";
}

function mockData(base: CockpitData | null, demoState: DemoState): CockpitData | null {
  if (!base) return base;
  const normalizedBase: CockpitData = {
    ...base,
    improvementLoop: base.improvementLoop || EMPTY_IMPROVEMENT_LOOP,
    readEvidence: base.readEvidence || EMPTY_READ_EVIDENCE,
  };
  if (demoState === "live") return normalizedBase;
  if (demoState === "empty") {
    return {
      ...normalizedBase,
      overview: { ...normalizedBase.overview, liveRuns: [], attention: [], health: [] },
      bank: [],
      calendar: [],
      fleet: [],
      runs: [],
      metrics: [],
      channels: [],
      alerts: [],
      warnings: [],
    };
  }
  if (demoState === "error") {
    return { ...normalizedBase, ok: false, warnings: [...normalizedBase.warnings, "API ответа нет: publishing cockpit read failed"] };
  }
  if (demoState === "partial") {
    return { ...normalizedBase, warnings: [...normalizedBase.warnings, "post_metrics недоступна: показываем ledger, fleet и publication pulse без рынка"] };
  }
  if (demoState === "ratelimited") {
    return {
      ...normalizedBase,
      alerts: [{
        id: "rate-limit-demo",
        kind: "publication",
        severity: "warn",
        title: "Pinterest rate limit",
        account: "norvia_pinterest",
        channel: "pinterest",
        time: new Date().toISOString(),
        evidence: "HTTP 429 · retry-after 900s",
        action: "Сдвинуть слоты / остудить аккаунт",
        stream: "product",
      }, ...normalizedBase.alerts],
    };
  }
  if (demoState === "banned") {
    return {
      ...normalizedBase,
      fleet: [{
        id: "banned-demo",
        handle: "manya_reels_04",
        platform: "instagram",
        stream: "manya",
        health: "banned",
        warmup: "banned",
        proxyKind: "mobile",
        proxySid: "proxy-778",
        cap: 3,
        posts: 1,
        lastPost: new Date().toISOString(),
        box: "box-2",
        session: false,
        profileId: "profile-778",
        banEvidence: "HTTP 302 → /challenge",
        complianceStatus: "approved",
      }, ...normalizedBase.fleet],
    };
  }
  if (demoState === "success") {
    return {
      ...normalizedBase,
      alerts: [],
      warnings: [],
      overview: {
        ...normalizedBase.overview,
        attention: [{ id: "success", severity: "warn", title: "Salvo complete", detail: "24ч без критических сбоев", targetScreen: "overview" }],
      },
    };
  }
  if (demoState === "salvo") {
    return {
      ...normalizedBase,
      runs: [{
        id: "salvo-1",
        recipeId: 0,
        publicationId: "salvo-1",
        platform: "telegram",
        account: "norvia_channel",
        article: "NV-08",
        stage: "retrying",
        timerSec: 94,
        progress: 0.62,
        reason: "fallback to caption-only post",
        attemptLabel: "2 / 3",
        publishedUrl: null,
        externalId: null,
        box: "cloud",
        status: "publishing",
      }, ...normalizedBase.runs],
    };
  }
  return normalizedBase;
}

export default function PublishingCockpit() {
  const params = useSearchParams();
  const [stream, setStream] = useState<StreamKey>("all");
  const [screen, setScreen] = useState<ScreenKey>((params.get("screen") as ScreenKey) || "overview");
  const [demoState, setDemoState] = useState<DemoState>((params.get("demoState") as DemoState) || "live");
  const [data, setData] = useState<CockpitData | null>(null);
  const [statusData, setStatusData] = useState<StatusData | null>(null);
  const [learningData, setLearningData] = useState<LearningData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [bankView, setBankView] = useState<"grid" | "list">("grid");
  const [bankChannel, setBankChannel] = useState("all");
  const [fleetGroupBy, setFleetGroupBy] = useState<"stream" | "flat">("stream");
  const [runFilter, setRunFilter] = useState<"all" | "publishing" | "failed" | "scheduled">("all");
  const [metricFilter, setMetricFilter] = useState<"all" | "winner" | "salvageable" | "fresh">("all");
  const [resolvedAlerts, setResolvedAlerts] = useState<string[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishResult, setPublishResult] = useState<Record<string, unknown> | null>(null);
  const [marketOpen, setMarketOpen] = useState(false);
  const [marketBusy, setMarketBusy] = useState(false);
  const [marketResult, setMarketResult] = useState<Record<string, unknown> | null>(null);
  const [marketContext, setMarketContext] = useState<MarketLoopContext | null>(null);
  const [marketForm, setMarketForm] = useState<MarketLoopFormState>({
    mode: "pull_live",
    views: "",
    watchRate: "",
    saves: "",
    orders: "",
    revenue: "",
  });
  const [selBank, setSelBank] = useState<string | null>(null);
  const [selCalendar, setSelCalendar] = useState<string | null>(null);
  const [selFleet, setSelFleet] = useState<string | null>(null);
  const [selRun, setSelRun] = useState<string | null>(null);
  const [selMetric, setSelMetric] = useState<string | null>(null);
  const [selChannel, setSelChannel] = useState<string | null>(null);
  const [selAlert, setSelAlert] = useState<string | null>(null);
  const [ritaOpen, setRitaOpen] = useState(false);
  const [ritaInput, setRitaInput] = useState("");
  const [ritaThread, setRitaThread] = useState<Array<{ role: "user" | "rita"; text: string; action?: ScreenKey }>>([
    { role: "rita", text: "Смотрю живые сигналы публикации, флот и тревоги. Могу быстро открыть нужный экран по приоритету." },
  ]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [publishForm, setPublishForm] = useState<PublishFormState>({
    platform: "pinterest",
    caption: "",
    hashtags: "",
    boardId: "",
    coverUrl: "",
    chatId: "",
    channelUsername: "",
  });

  useEffect(() => {
    const stateFromUrl = params.get("demoState") as DemoState | null;
    if (stateFromUrl) setDemoState(stateFromUrl);
    const screenFromUrl = params.get("screen") as ScreenKey | null;
    if (screenFromUrl && TABS.some((tab) => tab.id === screenFromUrl)) setScreen(screenFromUrl);
    const streamFromUrl = params.get("stream") as StreamKey | null;
    if (streamFromUrl && ["all", "product", "manya"].includes(streamFromUrl)) setStream(streamFromUrl);
  }, [params]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [cockpitRes, statusRes, learningRes] = await Promise.all([
          fetch(`/api/factory/publishing-cockpit?stream=${encodeURIComponent(stream)}`, { cache: "no-store" }),
          fetch("/api/factory/status", { cache: "no-store" }),
          fetch("/api/factory/learning?days=7", { cache: "no-store" }),
        ]);
        const cockpitJson = await cockpitRes.json();
        const statusJson = await statusRes.json().catch(() => null);
        const learningJson = await learningRes.json().catch(() => null);
        if (!cockpitRes.ok) throw new Error(String(cockpitJson.error || cockpitRes.statusText || cockpitRes.status));
        if (!cancelled) {
          setData(cockpitJson as CockpitData);
          setStatusData(statusJson as StatusData | null);
          setLearningData(learningJson as LearningData | null);
        }
      } catch (err) {
        if (!cancelled) setError(String((err as Error)?.message || err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [stream]);

  useEffect(() => {
    if (!toasts.length) return;
    const timer = setTimeout(() => {
      setToasts((current) => current.slice(1));
    }, 3600);
    return () => clearTimeout(timer);
  }, [toasts]);

  const vm = (loading && demoState === "loading") ? data : (mockData(data, demoState) || data);
  const improvementLoop = vm?.improvementLoop || EMPTY_IMPROVEMENT_LOOP;
  const readEvidence = vm?.readEvidence || EMPTY_READ_EVIDENCE;
  const learningWinners = learningData?.winners || [];
  const learningHooks = learningData?.hooks_by_niche || [];
  const learningPresets = learningData?.winner_presets || [];
  const learningSignals = learningData?.signals?.by_event || {};
  const topLoopNiche = improvementLoop.niche
    ? learningHooks.find((item) => item.niche === improvementLoop.niche) || null
    : learningHooks[0] || null;
  const topRejectReason = learningData?.signals?.top_reject?.[0] || null;
  const bankFiltered = (vm?.bank || [])
    .filter((item) => {
      if (!search.trim()) return true;
      const hay = `${item.article} ${item.title} ${item.niche} ${item.format}`.toLowerCase();
      return hay.includes(search.trim().toLowerCase());
    })
    .filter((item) => (bankChannel === "all" ? true : item.targetPlatform === bankChannel));
  const alertsFiltered = (vm?.alerts || [])
    .filter((item) => {
      if (!search.trim()) return true;
      const hay = `${item.title} ${item.account} ${item.channel} ${item.evidence}`.toLowerCase();
      return hay.includes(search.trim().toLowerCase());
    })
    .filter((item) => !resolvedAlerts.includes(item.id));
  const runsFiltered = (vm?.runs || []).filter((item) => (runFilter === "all" ? true : item.status === runFilter || item.stage === runFilter));
  const metricsFiltered = (vm?.metrics || []).filter((item) => (metricFilter === "all" ? true : item.status === metricFilter));
  const degradedModules = vm?.configured
    ? (Object.entries(vm.coverage)
      .filter(([key, available]) => !available && ["bank", "calendar", "fleet", "runs", "metrics"].includes(key))
      .map(([key]) => degradedLabel(key as "bank" | "calendar" | "fleet" | "runs" | "metrics")))
    : [];
  const bankReadLayerEmpty = Boolean(vm?.warnings?.some((warning) => warning.includes("bank_read_layer:")));
  const marketReadLayerEmpty = Boolean(vm?.warnings?.some((warning) => warning.includes("market_read_layer:")));
  const bankSelected = bankFiltered.find((item) => item.id === selBank) || bankFiltered[0] || null;
  const calendarSelected = (vm?.calendar || []).find((item) => item.id === selCalendar) || vm?.calendar?.[0] || null;
  const fleetSelected = (vm?.fleet || []).find((item) => item.id === selFleet) || vm?.fleet?.[0] || null;
  const runSelected = runsFiltered.find((item) => item.id === selRun) || runsFiltered[0] || null;
  const metricSelected = metricsFiltered.find((item) => item.id === selMetric) || metricsFiltered[0] || null;
  const channelSelected = (vm?.channels || []).find((item) => item.id === selChannel) || vm?.channels?.[0] || null;
  const alertSelected = alertsFiltered.find((item) => item.id === selAlert) || alertsFiltered[0] || null;
  const activeTab = TABS.find((tab) => tab.id === screen) || TABS[0];

  useEffect(() => {
    if (!bankSelected) return;
    setPublishForm((current) => ({
      ...current,
      platform: bankSelected.targetPlatform === "telegram" ? "telegram" : "pinterest",
      caption: current.caption || bankSelected.title,
    }));
  }, [bankSelected?.id]);

  function pushToast(kind: Toast["kind"], text: string) {
    setToasts((current) => [...current, { id: Date.now() + current.length, kind, text }]);
  }

  function answerRita(input: string) {
    const facts = vm;
    const q = input.toLowerCase();
    if (!facts) return { text: "Пока нет данных, жду boot payload от publishing cockpit." };
    if (q.includes("вним") || q.includes("трев")) {
      const top = facts.alerts[0];
      return top ? { text: `Сейчас первым делом: ${top.title}. Доказательство: ${top.evidence}.`, action: "alerts" as ScreenKey } : { text: "Критических тревог сейчас не вижу, можно идти в метрики и bank." };
    }
    if (q.includes("готов") || q.includes("банк") || q.includes("выклад")) {
      return { text: `В банке готово ${facts.bank.filter((item) => item.status === "ready").length} роликов, из них под уникализацию Мани ${facts.bank.filter((item) => item.needsUniqueVariant).length}.`, action: "bank" as ScreenKey };
    }
    if (q.includes("флот") || q.includes("здоров") || q.includes("бан")) {
      return { text: `Во флоте ${facts.fleet.length} аккаунтов. Критичных: ${facts.fleet.filter((item) => item.health === "banned" || item.health === "needs-login").length}, прогрев: ${facts.fleet.filter((item) => item.health === "warming").length}.`, action: "fleet" as ScreenKey };
    }
    if (q.includes("побед") || q.includes("метрик") || q.includes("v5")) {
      return { text: `Победителей по порогу 5000 сейчас ${facts.metrics.filter((item) => item.status === "winner").length}. Есть ${facts.metrics.filter((item) => item.status === "salvageable").length} роликов, которые стоит дотянуть.`, action: "metrics" as ScreenKey };
    }
    if (q.includes("цикл") || q.includes("learn") || q.includes("хук")) {
      return { text: `${facts.improvementLoop.nextStep}. Пресетов победителей: ${facts.improvementLoop.winnerPresets}, winners 7д: ${facts.improvementLoop.winners7d}.`, action: "metrics" as ScreenKey };
    }
    return { text: "Могу подсказать по тревогам, банку, флоту, live runs и победителям. Спроси коротко, что именно тебя интересует." };
  }

  function submitRita() {
    const input = ritaInput.trim();
    if (!input) return;
    const answer = answerRita(input);
    setRitaThread((current) => [...current, { role: "user", text: input }, { role: "rita", text: answer.text, action: answer.action }]);
    setRitaInput("");
  }

  function refresh() {
    setLoading(true);
    pushToast("info", "Обновляю publishing cockpit");
    Promise.all([
      fetch(`/api/factory/publishing-cockpit?stream=${encodeURIComponent(stream)}`, { cache: "no-store" })
        .then((res) => res.json().then((json) => ({ ok: res.ok, json }))),
      fetch("/api/factory/status", { cache: "no-store" })
        .then((res) => res.json().catch(() => null)),
      fetch("/api/factory/learning?days=7", { cache: "no-store" })
        .then((res) => res.json().catch(() => null)),
    ])
      .then(([cockpit, status, learning]) => {
        if (!cockpit.ok) throw new Error(String(cockpit.json.error || "refresh failed"));
        setData(cockpit.json as CockpitData);
        setStatusData((status || null) as StatusData | null);
        setLearningData((learning || null) as LearningData | null);
        pushToast("ok", "Данные обновлены");
      })
      .catch((err) => {
        setError(String((err as Error)?.message || err));
        pushToast("err", "Не удалось обновить данные");
      })
      .finally(() => setLoading(false));
  }

  function openMarketLoop(context: MarketLoopContext, preferredMode: "pull_live" | "manual", defaults?: Partial<MarketLoopFormState>) {
    setMarketContext(context);
    setMarketResult(null);
    setMarketForm({
      mode: preferredMode,
      views: defaults?.views || "",
      watchRate: defaults?.watchRate || "",
      saves: defaults?.saves || "",
      orders: defaults?.orders || "",
      revenue: defaults?.revenue || "",
    });
    setMarketOpen(true);
  }

  async function submitMarketLoop() {
    if (!marketContext?.recipeId) {
      pushToast("err", "Для market loop нужен recipe_id");
      return;
    }
    if (marketForm.mode === "manual" && !marketForm.views.trim()) {
      pushToast("err", "Для ручного push нужны просмотры");
      return;
    }

    setMarketBusy(true);
    setMarketResult(null);
    try {
      const payload = marketForm.mode === "pull_live"
        ? {
          recipe_id: marketContext.recipeId,
          publication_id: marketContext.publicationId || undefined,
          external_post_id: marketContext.externalPostId || undefined,
          pull_live: true,
        }
        : {
          recipe_id: marketContext.recipeId,
          publication_id: marketContext.publicationId || undefined,
          external_post_id: marketContext.externalPostId || undefined,
          platform: marketContext.platform,
          views: Number(marketForm.views) || 0,
          watch_rate: marketForm.watchRate ? Number(marketForm.watchRate) : undefined,
          saves: marketForm.saves ? Number(marketForm.saves) : undefined,
          marketplace_orders: marketForm.orders ? Number(marketForm.orders) : undefined,
          revenue: marketForm.revenue ? Number(marketForm.revenue) : undefined,
        };

      const res = await fetch("/api/factory/post-metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      setMarketResult(json as Record<string, unknown>);
      if (!res.ok || json?.ok !== true) {
        throw new Error(String((json as Record<string, unknown>)?.error || "post-metrics failed"));
      }
      pushToast("ok", marketForm.mode === "pull_live" ? "Live metrics обновлены" : "Метрики отправлены в market loop");
      refresh();
    } catch (error) {
      pushToast("err", String((error as Error)?.message || error));
    } finally {
      setMarketBusy(false);
    }
  }

  function openPublishModal() {
    if (!bankSelected) return;
    setPublishResult(null);
    setPublishForm({
      platform: bankSelected.targetPlatform === "telegram" ? "telegram" : "pinterest",
      caption: bankSelected.title,
      hashtags: bankSelected.article ? `#${bankSelected.article}` : "",
      boardId: "",
      coverUrl: "",
      chatId: "",
      channelUsername: "",
    });
    setPublishOpen(true);
  }

  async function submitPublish() {
    if (!bankSelected?.outputUrl) {
      pushToast("err", "У выбранного ролика пока нет output_url для публикации");
      return;
    }

    const hashtags = publishForm.hashtags
      .split(/[,\n ]+/)
      .map((item) => item.trim())
      .filter(Boolean);

    const targetId = publishForm.platform === "pinterest"
      ? `product-pinterest-${bankSelected.stream}`
      : `product-telegram-${bankSelected.stream}`;

    const targetDraft = publishForm.platform === "pinterest"
      ? {
        id: targetId,
        platform: "pinterest",
        account_ref: bankSelected.stream === "manya" ? "manya_pinterest" : "product_pinterest",
        mode: "organic",
        config: {
          board_id: publishForm.boardId,
        },
      }
      : {
        id: targetId,
        platform: "telegram",
        account_ref: bankSelected.stream === "manya" ? "manya_telegram" : "product_telegram",
        mode: "organic",
        config: {
          chat_id: publishForm.chatId || undefined,
          channel_username: publishForm.channelUsername || undefined,
        },
      };

    setPublishBusy(true);
    setPublishResult(null);
    try {
      let target = targetDraft;
      const targetRes = await fetch("/api/factory/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targetDraft),
      });
      const targetJson = await targetRes.json().catch(() => ({}));
      if (!targetRes.ok || targetJson?.ok !== true) {
        throw new Error(String((targetJson as Record<string, unknown>)?.error || "target upsert failed"));
      }
      if ((targetJson as { target?: Record<string, unknown> }).target) {
        target = (targetJson as { target: typeof targetDraft }).target;
      }

      const res = await fetch("/api/factory/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipe_id: bankSelected.recipeId,
          article: bankSelected.article,
          caption: publishForm.caption,
          hashtags,
          video_path_or_url: bankSelected.outputUrl,
          cover_url: publishForm.coverUrl || undefined,
          target,
          metadata: {
            launched_from: "publication-cockpit",
            stream: bankSelected.stream,
            target_platform: publishForm.platform,
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      setPublishResult(json as Record<string, unknown>);
      if (!res.ok || json?.ok !== true) {
        throw new Error(String((json as Record<string, unknown>)?.error || "publish failed"));
      }
      pushToast("ok", "Публикация отправлена");
      refresh();
    } catch (error) {
      pushToast("err", String((error as Error)?.message || error));
    } finally {
      setPublishBusy(false);
    }
  }

  function copyField(label: string, value: string | null | undefined) {
    if (!value) {
      pushToast("info", `${label}: пока нечего копировать`);
      return;
    }
    navigator.clipboard.writeText(value).then(
      () => pushToast("ok", `${label} скопирован`),
      () => pushToast("err", `Не удалось скопировать ${label}`),
    );
  }

  function renderInspector() {
    if (!vm?.configured) return null;
    if (screen === "bank" && bankSelected) {
      const readyForPublish = Boolean(bankSelected.recipeId && bankSelected.outputUrl);
      const publishCoverage = bankSelected.published.length ? bankSelected.published.join(", ") : "not yet";
      const publishBlocker = !bankSelected.recipeId
        ? "Нет связанного recipe_id: asset виден в банке, но post_metrics и winners не смогут замкнуться."
        : !bankSelected.outputUrl
          ? "Нет output_url: adapter не получит готовый видео-файл для публикации."
          : bankSelected.needsUniqueVariant
            ? "Нужен unique-вариант под поток Маня, иначе контент пойдёт повтором."
            : "Карточка готова к live publish path и следующему market-loop poll.";
      return (
        <aside className="pc-card pc-inspector">
          <div className="pc-card-head">
            <div>
              <div className="pc-title">Оператор · контент</div>
              <div className="pc-sub">{bankSelected.article} · {bankSelected.title}</div>
            </div>
            <span className={`pc-pill ${statusTone(bankSelected.status)}`}>{bankSelected.status}</span>
          </div>
          <div className="pc-improvement-box">
            <div className="pc-state-line"><span className="pc-label">niche</span><span>{bankSelected.niche}</span></div>
            <div className="pc-state-line"><span className="pc-label">format</span><span>{bankSelected.format}</span></div>
            <div className="pc-state-line"><span className="pc-label">target</span><span>{bankSelected.targetPlatform}</span></div>
            <div className="pc-state-line"><span className="pc-label">stream</span><span>{bankSelected.stream}</span></div>
            <div className="pc-state-line"><span className="pc-label">otk</span><span>{bankSelected.otkScore == null ? "—" : bankSelected.otkScore.toFixed(1)}</span></div>
            <div className="pc-state-line"><span className="pc-label">updated</span><span>{fmtAgo(bankSelected.updatedAt)}</span></div>
          </div>
          <div className="pc-improvement-box">
            <div className="pc-label" style={{ marginBottom: 2 }}>publish path</div>
            <div className="pc-state-line"><span className="pc-label">recipe</span><span>{bankSelected.recipeId ? String(bankSelected.recipeId) : "fallback asset"}</span></div>
            <div className="pc-state-line"><span className="pc-label">output</span><span>{bankSelected.outputUrl ? "ready" : "missing"}</span></div>
            <div className="pc-state-line"><span className="pc-label">published</span><span>{publishCoverage}</span></div>
            <div className="pc-state-line"><span className="pc-label">loop write</span><span>{readyForPublish ? "armed" : "blocked"}</span></div>
          </div>
          <div className={`pc-note ${readyForPublish ? "" : "pc-note-warn"}`}>{publishBlocker}</div>
          <div className="pc-action-col">
            <button className="pc-primary" disabled={!bankSelected.recipeId || !bankSelected.outputUrl} onClick={openPublishModal}>Опубликовать</button>
            <button className="pc-primary ghost" onClick={() => pushToast("info", "В расписание: пока только read-only preview")}>В расписание</button>
          </div>
        </aside>
      );
    }
    if (screen === "calendar" && calendarSelected) {
      return (
        <aside className="pc-card pc-inspector">
          <div className="pc-card-head">
            <div>
              <div className="pc-title">Слот публикации</div>
              <div className="pc-sub">{calendarSelected.group} · {calendarSelected.platform}</div>
            </div>
            <span className={`pc-pill ${statusTone(calendarSelected.state)}`}>{calendarSelected.state}</span>
          </div>
          <InspectorLine label="День" value={calendarSelected.day} />
          <InspectorLine label="Артикул" value={calendarSelected.article} />
          <InspectorLine label="Время" value={calendarSelected.time || "—"} />
          <InspectorLine label="Комплаенс" value={calendarSelected.complianceLocked ? "locked" : "open"} />
          <div className="pc-improvement-box">
            <div className="pc-label" style={{ marginBottom: 8 }}>slot state</div>
            <div className="pc-state-line"><span className="pc-label">group</span><span>{calendarSelected.group}</span></div>
            <div className="pc-state-line"><span className="pc-label">platform</span><span>{calendarSelected.platform}</span></div>
            <div className="pc-state-line"><span className="pc-label">state</span><span>{calendarSelected.state}</span></div>
          </div>
          <div className="pc-note">{calendarSelected.complianceLocked ? "Слот замкнут комплаенсом: нужен approved статус перед paid-post." : "Пустые и открытые слоты отсюда будут раскладываться в следующем write-pass."}</div>
        </aside>
      );
    }
    if (screen === "fleet" && fleetSelected) {
      return (
        <aside className="pc-card pc-inspector">
          <div className="pc-card-head">
            <div>
              <div className="pc-title">Аккаунт</div>
              <div className="pc-sub">{fleetSelected.handle} · {fleetSelected.platform}</div>
            </div>
            <span className={`pc-pill ${statusTone(fleetSelected.health)}`}>{fleetSelected.health}</span>
          </div>
          <InspectorLine label="Stream" value={fleetSelected.stream} />
          <InspectorLine label="Warmup" value={fleetSelected.warmup} />
          <InspectorLine label="Proxy" value={`${fleetSelected.proxyKind}${fleetSelected.proxySid ? ` · ${fleetSelected.proxySid}` : ""}`} />
          <InspectorLine label="Profile" value={fleetSelected.profileId || "—"} />
          <InspectorLine label="Box" value={fleetSelected.box} />
          <InspectorLine label="Posts today" value={`${fleetSelected.posts ?? 0}/${fleetSelected.cap ?? "—"}`} />
          <InspectorLine label="Last post" value={fmtAgo(fleetSelected.lastPost)} />
          <InspectorLine label="Compliance" value={fleetSelected.complianceStatus || "unknown"} />
          <div className="pc-improvement-box">
            <div className="pc-label" style={{ marginBottom: 8 }}>runtime</div>
            <div className="pc-state-line"><span className="pc-label">session</span><span>{fleetSelected.session == null ? "unknown" : fleetSelected.session ? "alive" : "dead"}</span></div>
            <div className="pc-state-line"><span className="pc-label">health</span><span>{fleetSelected.health}</span></div>
            <div className="pc-state-line"><span className="pc-label">warmup</span><span>{fleetSelected.warmup}</span></div>
          </div>
          {fleetSelected.banEvidence ? <div className="pc-note">{fleetSelected.banEvidence}</div> : null}
          <div className="pc-action-row">
            <button className="pc-primary ghost" onClick={() => copyField("proxy_sid", fleetSelected.proxySid)}><Copy size={13} /> proxy</button>
            <button className="pc-primary ghost" onClick={() => copyField("profile_id", fleetSelected.profileId)}><Copy size={13} /> profile</button>
          </div>
        </aside>
      );
    }
    if (screen === "runs" && runSelected) {
      return (
        <aside className="pc-card pc-inspector">
          <div className="pc-card-head">
            <div>
              <div className="pc-title">Прогон</div>
              <div className="pc-sub">{runSelected.account} · {runSelected.article}</div>
            </div>
            <span className={`pc-pill ${statusTone(runSelected.status)}`}>{runSelected.status}</span>
          </div>
          <InspectorLine label="Stage" value={runSelected.stage} />
          <InspectorLine label="Timer" value={fmtTimer(runSelected.timerSec)} />
          <InspectorLine label="Attempt" value={runSelected.attemptLabel || "1 / 3"} />
          <InspectorLine label="Box" value={runSelected.box} />
          <InspectorLine label="Reason" value={runSelected.reason || "—"} />
          <InspectorLine label="External" value={runSelected.externalId || "—"} />
          <div className="pc-action-row">
            <button className="pc-primary ghost" onClick={() => copyField("external_id", runSelected.externalId)}><Copy size={13} /> external</button>
            <button
              className="pc-primary ghost"
              onClick={() => openMarketLoop({
                recipeId: runSelected.recipeId,
                publicationId: runSelected.publicationId,
                externalPostId: runSelected.externalId,
                platform: runSelected.platform,
                article: runSelected.article,
              }, "pull_live")}
            >
              Live poll
            </button>
            <button className="pc-primary ghost" onClick={() => pushToast("info", "Retry / cancel будут write-layer в следующем цикле")}>Повторить</button>
          </div>
        </aside>
      );
    }
    if (screen === "metrics" && metricSelected) {
      return (
        <aside className="pc-card pc-inspector">
          <div className="pc-card-head">
            <div>
              <div className="pc-title">Публикация и метрики</div>
              <div className="pc-sub">{metricSelected.article} · {metricSelected.platform}</div>
            </div>
            <span className={`pc-pill ${statusTone(metricSelected.status)}`}>{metricSelected.status}</span>
          </div>
          <InspectorLine label="Views" value={fmtNumber(metricSelected.views)} />
          <InspectorLine label="Watch" value={fmtPct(metricSelected.watch)} />
          <InspectorLine label="Saves" value={fmtNumber(metricSelected.saves)} />
          <InspectorLine label="Orders" value={fmtNumber(metricSelected.orders)} />
          <InspectorLine label="Revenue" value={metricSelected.revenue == null ? "—" : fmtNumber(metricSelected.revenue)} />
          <InspectorLine label="Posted" value={fmtAgo(metricSelected.postedAt)} />
          <InspectorLine label="Recipe" value={metricSelected.recipeId ? String(metricSelected.recipeId) : "—"} />
          <InspectorLine label="Publication" value={metricSelected.publicationId || "—"} />
          <InspectorLine label="External" value={metricSelected.externalPostId || "—"} />
          <div className="pc-note">{metricSelected.status === "winner" ? "Порог V5 пройден: этот ролик должен возвращаться в winners/improvement loop." : "Это промежуточный сигнал рынка; по нему уже можно решать, тянуть ли ролик дальше или бросать."}</div>
          <div className="pc-action-row">
            <button
              className="pc-primary ghost"
              onClick={() => openMarketLoop({
                recipeId: metricSelected.recipeId,
                publicationId: metricSelected.publicationId,
                externalPostId: metricSelected.externalPostId,
                platform: metricSelected.platform,
                article: metricSelected.article,
              }, "pull_live")}
            >
              Live poll
            </button>
            <button
              className="pc-primary ghost"
              onClick={() => openMarketLoop({
                recipeId: metricSelected.recipeId,
                publicationId: metricSelected.publicationId,
                externalPostId: metricSelected.externalPostId,
                platform: metricSelected.platform,
                article: metricSelected.article,
              }, "manual", {
                views: String(metricSelected.views || ""),
                watchRate: metricSelected.watch == null ? "" : String(metricSelected.watch),
                saves: metricSelected.saves == null ? "" : String(metricSelected.saves),
                orders: metricSelected.orders == null ? "" : String(metricSelected.orders),
                revenue: metricSelected.revenue == null ? "" : String(metricSelected.revenue),
              })}
            >
              Manual push
            </button>
          </div>
          {metricSelected.status === "winner" ? (
            <div className="pc-improvement-box">
              <div className="pc-label" style={{ marginBottom: 8 }}>improvement loop</div>
              <div className="pc-note">{improvementLoop.nextStep}</div>
              <div className="pc-state-line"><span className="pc-label">niche</span><span>{improvementLoop.niche || "—"}</span></div>
              <div className="pc-state-line"><span className="pc-label">winner presets</span><span>{improvementLoop.winnerPresets}</span></div>
              <div className="pc-state-line"><span className="pc-label">ready</span><span>{improvementLoop.ready ? "yes" : "partial"}</span></div>
              {improvementLoop.learningHints ? <div className="pc-note">{improvementLoop.learningHints}</div> : null}
            </div>
          ) : null}
        </aside>
      );
    }
    if (screen === "channels" && channelSelected) {
      const wave1 = statusData?.publication_wave1 || null;
      return (
        <aside className="pc-card pc-inspector">
          <div className="pc-card-head">
            <div>
              <div className="pc-title">Канал / адаптер</div>
              <div className="pc-sub">{channelSelected.name}</div>
            </div>
            <span className={`pc-pill ${statusTone(channelSelected.status)}`}>{channelSelected.status}</span>
          </div>
          <InspectorLine label="Transport" value={channelSelected.transport} />
          <InspectorLine label="Runs on" value={channelSelected.runsOn} />
          <InspectorLine label="Publish" value={channelSelected.publishEnabled ? "enabled" : "off"} />
          <InspectorLine label="Analytics" value={channelSelected.metricsEnabled ? "native pull" : "not in wave-1"} />
          <InspectorLine label="Accounts" value={String(channelSelected.accounts)} />
          <InspectorLine label="Alerts" value={String(channelSelected.alerts)} />
          {wave1 && (channelSelected.platform === "telegram" || channelSelected.platform === "pinterest") ? (
            <div className="pc-improvement-box">
              <div className="pc-label" style={{ marginBottom: 8 }}>wave-1 readiness</div>
              {channelSelected.platform === "telegram" ? (
                <>
                  <div className="pc-state-line"><span className="pc-label">bot token</span><span>{wave1.telegram_bot ? "ready" : "missing"}</span></div>
                  <div className="pc-state-line"><span className="pc-label">owner chat</span><span>{wave1.telegram_chat ? "ready" : "missing"}</span></div>
                  <div className="pc-state-line"><span className="pc-label">live fact</span><span>publish smoke passed</span></div>
                </>
              ) : (
                <>
                  <div className="pc-state-line"><span className="pc-label">access token</span><span>{wave1.pinterest_token ? "ready" : "missing"}</span></div>
                  <div className="pc-state-line"><span className="pc-label">analytics pull</span><span>native adapter ready</span></div>
                  <div className="pc-state-line"><span className="pc-label">live fact</span><span>{wave1.pinterest_token ? "awaiting smoke" : "blocked by token"}</span></div>
                </>
              )}
            </div>
          ) : null}
          <div className="pc-note">
            {channelSelected.transport === "unconfirmed"
              ? "Транспорт ещё не подтверждён: это допустимое состояние для wave-2/wave-3 каналов."
              : channelSelected.metricsEnabled
                ? "Канал уже готов не только к publish, но и к native metrics pull для market loop."
                : "Канал уже годится для cloud publish, но аналитика в wave-1 пока не тянется через native adapter."}
          </div>
        </aside>
      );
    }
    if (screen === "alerts" && alertSelected) {
      return (
        <aside className="pc-card pc-inspector">
          <div className="pc-card-head">
            <div>
              <div className="pc-title">Тревога</div>
              <div className="pc-sub">{alertSelected.account} · {alertSelected.channel}</div>
            </div>
            <span className={`pc-pill ${statusTone(alertSelected.severity)}`}>{alertSelected.severity}</span>
          </div>
          <InspectorLine label="Kind" value={alertSelected.kind} />
          <InspectorLine label="Time" value={fmtAgo(alertSelected.time)} />
          <InspectorLine label="Action" value={alertSelected.action} />
          <div className="pc-improvement-box">
            <div className="pc-label" style={{ marginBottom: 8 }}>impact</div>
            <div className="pc-state-line"><span className="pc-label">channel</span><span>{alertSelected.channel}</span></div>
            <div className="pc-state-line"><span className="pc-label">account</span><span>{alertSelected.account}</span></div>
            <div className="pc-state-line"><span className="pc-label">severity</span><span>{alertSelected.severity}</span></div>
          </div>
          <div className="pc-note">{alertSelected.evidence}</div>
          <div className="pc-action-row">
            <button className="pc-primary ghost" onClick={() => setResolvedAlerts((current) => [...current, alertSelected.id])}>Resolve</button>
            <button className="pc-primary ghost" onClick={() => copyField("evidence", alertSelected.evidence)}><Copy size={13} /> evidence</button>
          </div>
        </aside>
      );
    }
    return null;
  }

  function renderScreen() {
    if (loading || demoState === "loading") {
      return (
        <div className="pc-grid pc-grid-3">
          <div className="pc-skeleton-card" />
          <div className="pc-skeleton-card" />
          <div className="pc-skeleton-card" />
          <div className="pc-skeleton-card tall" />
          <div className="pc-skeleton-card tall" />
        </div>
      );
    }
    if (error || !vm?.ok) {
      return (
        <div className="pc-empty">
          <ShieldAlert size={28} />
          <h3>Не удалось собрать Publishing Cockpit</h3>
          <p>{error || vm?.warnings?.[0] || "read-only payload вернул ошибку"}</p>
          <button className="pc-primary" onClick={refresh}>Повторить</button>
        </div>
      );
    }
    if (!vm.configured) {
      const wave1Boot = statusData?.publication_wave1 || null;
      const bootChannels = channelPreview.length ? channelPreview : [
        {
          id: "pinterest",
          name: "Pinterest",
          platform: "pinterest",
          transport: "api" as const,
          runsOn: "Vercel",
          status: wave1Boot?.pinterest_token ? "api-configured" : "token-missing",
          accounts: 0,
          alerts: wave1Boot?.pinterest_token ? 0 : 1,
          publishEnabled: true,
          metricsEnabled: true,
        },
        {
          id: "telegram",
          name: "Telegram",
          platform: "telegram",
          transport: "api" as const,
          runsOn: "Vercel",
          status: wave1Boot?.telegram_bot && wave1Boot?.telegram_chat ? "api-configured" : "token-missing",
          accounts: wave1Boot?.telegram_bot && wave1Boot?.telegram_chat ? 1 : 0,
          alerts: wave1Boot?.telegram_bot && wave1Boot?.telegram_chat ? 0 : 1,
          publishEnabled: true,
          metricsEnabled: false,
        },
      ];
      return (
        <section className="pc-grid pc-grid-2 pc-boot-shell">
          <div className="pc-card pc-boot-card">
            <div className="pc-card-head">
              <div>
                <div className="pc-title">Контур готов, live-данных пока нет</div>
                <div className="pc-sub">clean pod работает в safe read-only режиме</div>
              </div>
              <span className="pc-pill warn">configured:false</span>
            </div>
            <div className="pc-boot-copy">
              <p>Publication Cockpit уже изолирован от finance-shell. Если этот pod ещё не вошёл в live mode, значит read-layer или wave-1 readiness в текущем окружении пока не дотянуты до рабочего уровня.</p>
              <div className="pc-boot-stats">
                <div className="pc-boot-stat">
                  <span className="pc-label">backend</span>
                  <strong>read-only boot</strong>
                  <span>surface поднят, но payload ещё не подтвердил рабочее чтение</span>
                </div>
                <div className="pc-boot-stat">
                  <span className="pc-label">wave-1</span>
                  <strong>Pinterest + Telegram</strong>
                  <span>adapter layer готов; unlock зависит от env, token и read/write parity</span>
                </div>
                <div className="pc-boot-stat">
                  <span className="pc-label">market loop</span>
                  <strong>post-metrics → winners</strong>
                  <span>manual ingest и live pull path уже заведены, но им нужна видимость market rows</span>
                </div>
              </div>
              <div className="pc-action-row">
                <button className="pc-primary" onClick={refresh}>Проверить снова</button>
                <button className="pc-primary ghost" onClick={() => setScreen("channels")}>Открыть каналы</button>
              </div>
            </div>
          </div>

          <div className="pc-card pc-boot-panel">
            <div className="pc-card-head">
              <div>
                <div className="pc-title">Worker pulse</div>
                <div className="pc-sub">облачный раннер и heartbeat</div>
              </div>
              <span className={`pc-pill ${statusTone(vm.worker.state)}`}>{workerTitle}</span>
            </div>
            <div className="pc-boot-info-list">
              <div className="pc-boot-info-row">
                <span className="pc-label">source</span>
                <strong>{vm.worker.source || "unknown"}</strong>
              </div>
              <div className="pc-boot-info-row">
                <span className="pc-label">last seen</span>
                <strong>{fmtAgo(vm.worker.lastSeen)}</strong>
              </div>
              <div className="pc-boot-info-row">
                <span className="pc-label">current task</span>
                <strong>{vm.worker.currentTask || "—"}</strong>
              </div>
            </div>
            <div className="pc-note">{vm.worker.diagnostics?.detail || "Heartbeat-диагностика пока без дополнительных деталей."}</div>
          </div>

          <div className="pc-card pc-span-2 pc-boot-panel">
            <div className="pc-card-head">
              <div>
                <div className="pc-title">Wave-1 channels</div>
                <div className="pc-sub">Pinterest и Telegram уже заведены в adapter layer</div>
              </div>
            </div>
            <div className="pc-grid pc-grid-3 pc-boot-grid">
              {bootChannels.map((channel) => (
                <article key={channel.id} className="pc-card pc-mini-card">
                  <div className="pc-bank-top">
                    <div>
                      <div className="pc-bank-title">{channel.name}</div>
                      <div className="pc-bank-meta">{transportLabel(channel.transport as CockpitData["channels"][number]["transport"])} · {channel.runsOn}</div>
                    </div>
                    <span className={`pc-pill ${statusTone(channel.status)}`}>{channelStatusLabel(channel.status)}</span>
                  </div>
                  <div className="pc-boot-channel-metrics">
                    <div><span>Аккаунтов</span><strong>{channel.accounts}</strong></div>
                    <div><span>Тревог</span><strong>{channel.alerts}</strong></div>
                  </div>
                </article>
              ))}
              <article className="pc-card pc-mini-card">
                <div className="pc-bank-title">Что unlock’нет live mode</div>
                <div className="pc-checklist">
                  <div className="pc-note">1. read-layer должен увидеть source rows без schema-gap</div>
                  <div className="pc-note">2. `FACTORY_PINTEREST_ACCESS_TOKEN` unlock’нет Pinterest publish + analytics</div>
                  <div className="pc-note">3. полная parity у `post_metrics` уберёт legacy fallback из market loop</div>
                </div>
              </article>
            </div>
          </div>
        </section>
      );
    }

    if (screen === "overview") {
      return (
        <div className="pc-overview">
          <div className="pc-kpis">
            {vm.overview.tiles.map((tile) => (
              <button key={tile.id} className="pc-card pc-kpi" onClick={() => setScreen(tile.targetScreen as ScreenKey)}>
                <div className="pc-kpi-copy">
                  <div className="pc-label">{tile.label}</div>
                  <div className="pc-kpi-value">{fmtNumber(tile.value)}</div>
                </div>
                <div className="pc-kpi-foot">
                  <div className="pc-kpi-delta">{tile.delta > 0 ? "+" : ""}{tile.delta}</div>
                  <svg className="pc-spark" viewBox="0 0 64 20" preserveAspectRatio="none">
                    <path d={sparkPath(tile.spark)} />
                  </svg>
                </div>
              </button>
            ))}
          </div>

          <div className="pc-overview-main">
            <section className="pc-card pc-overview-card">
              <div className="pc-overview-head">
                <span className="pc-overview-kicker">Живой прогон</span>
                <button className="pc-link" onClick={() => setScreen("runs")}>Все прогоны →</button>
              </div>
              {!vm.overview.liveRuns.length ? (
                <EmptyInline text="Сейчас нет активных прогонов. Можно добросить контент из банка в расписание." />
              ) : vm.overview.liveRuns.map((run) => (
                <div key={run.id} className="pc-run-row pc-overview-run">
                  <div className="pc-overview-run-lead">
                    <div className={`pc-dot ${statusTone(run.status)}`} />
                    <div className="pc-overview-platform">{run.platform}</div>
                  </div>
                  <div className="pc-mono pc-overview-account">{run.account}</div>
                  <div className="pc-run-main">
                    <div className="pc-run-top">{run.stage === "published" ? "Опубликовано" : run.stage}</div>
                    <div className="pc-run-bottom">{run.article}{run.attemptLabel ? ` · ${run.attemptLabel}` : ""}</div>
                  </div>
                  <div className="pc-mono pc-overview-timer">{fmtTimer(run.timerSec)}</div>
                </div>
              ))}
            </section>

            <section className="pc-card pc-overview-card">
              <div className="pc-overview-head">
                <span className="pc-overview-kicker">Требует внимания</span>
                <button className="pc-link" onClick={() => setScreen("alerts")}>Все →</button>
              </div>
              {!vm.overview.attention.length ? (
                <div className="pc-overview-empty">
                  <CheckCircle2 size={18} />
                  <span>Тревог нет</span>
                </div>
              ) : vm.overview.attention.map((alert) => (
                <button key={alert.id} className={`pc-overview-alert-row ${alert.severity}`} onClick={() => setScreen(alert.targetScreen as ScreenKey)}>
                  <span className="pc-overview-alert-icon"><AlertTriangle size={14} /></span>
                  <div className="pc-overview-alert-copy">
                    <div className="pc-attention-title">{alert.title}</div>
                    <div className="pc-overview-alert-meta">{alert.detail}</div>
                  </div>
                </button>
              ))}
            </section>
          </div>

          <section className="pc-card pc-overview-card">
            <div className="pc-overview-head">
              <span className="pc-overview-kicker">Флот · здоровье</span>
              <button className="pc-link" onClick={() => setScreen("fleet")}>Флот →</button>
            </div>
            {vm.overview.health.some((bucket) => bucket.key === "banned") ? (
              <div className="pc-fleet-alert">
                <AlertTriangle size={14} />
                <span>{vm.overview.health.find((bucket) => bucket.key === "banned")?.count || 0} аккаунта забанены за 24ч → Флот</span>
              </div>
            ) : null}
            {!vm.overview.health.length ? (
              <EmptyInline text="Флот пока пуст. Это состояние тоже поддержано: можно заводить аккаунты и прогрев с нуля." />
            ) : (
              <>
                <div className="pc-health-bar compact">
                  {vm.overview.health.map((bucket) => (
                    <div key={bucket.key} className="pc-health-segment" style={{ flex: Math.max(1, bucket.count), background: bucket.color }} />
                  ))}
                </div>
                <div className="pc-legend compact">
                  {vm.overview.health.map((bucket) => (
                    <div key={bucket.key} className="pc-legend-item compact">
                      <span className="pc-legend-dot" style={{ background: bucket.color }} />
                      <span>{bucket.label}</span>
                      <strong>{bucket.count}</strong>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      );
    }

    if (screen === "bank") {
      const bankReadyCount = bankFiltered.filter((item) => item.status === "ready").length;
      const bankUniqueCount = bankFiltered.filter((item) => item.needsUniqueVariant).length;
      const bankPublishedCount = bankFiltered.filter((item) => item.published.length > 0).length;
      const bankMissingOutputCount = bankFiltered.filter((item) => !item.outputUrl).length;
      return (
        <section className="pc-grid pc-grid-shell">
          <section className="pc-card pc-span-main">
            <div className="pc-toolbar">
              <label className="pc-search">
                <Search size={15} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Артикул или ниша…" />
              </label>
              <div className="pc-chipset pc-bank-filters">
                <button className={`pc-chip ${bankChannel === "all" ? "active" : ""}`} onClick={() => setBankChannel("all")}>all</button>
                <button className={`pc-chip ${bankChannel === "pinterest" ? "active" : ""}`} onClick={() => setBankChannel("pinterest")}>Pinterest</button>
                <button className={`pc-chip ${bankChannel === "telegram" ? "active" : ""}`} onClick={() => setBankChannel("telegram")}>Telegram</button>
                <span className="pc-bank-filter-note">…и другие из реестра</span>
              </div>
              <div className="pc-toolbar-spacer" />
              <div className="pc-chipset pc-bank-view-toggle">
                <button className={`pc-chip ${bankView === "grid" ? "active" : ""}`} onClick={() => setBankView("grid")}><LayoutGrid size={13} /> grid</button>
                <button className={`pc-chip ${bankView === "list" ? "active" : ""}`} onClick={() => setBankView("list")}><View size={13} /> list</button>
              </div>
            </div>
            <div className="pc-summary-band pc-summary-band-bank">
              <div className="pc-summary-stat">
                <span className="pc-label">ready to post</span>
                <strong>{fmtNumber(bankReadyCount)}</strong>
              </div>
              <div className="pc-summary-stat">
                <span className="pc-label">need unique</span>
                <strong>{fmtNumber(bankUniqueCount)}</strong>
              </div>
              <div className="pc-summary-stat">
                <span className="pc-label">already used</span>
                <strong>{fmtNumber(bankPublishedCount)}</strong>
              </div>
              <div className="pc-summary-stat">
                <span className="pc-label">output missing</span>
                <strong>{fmtNumber(bankMissingOutputCount)}</strong>
              </div>
            </div>
            {!bankFiltered.length ? (
              <>
                <EmptyStatePanel
                  eyebrow={!vm.coverage.bank ? "read-layer missing" : bankReadLayerEmpty ? "source visibility gap" : "empty bank"}
                  title={!vm.coverage.bank
                    ? "Банк пока не собран в clean pod"
                    : bankReadLayerEmpty
                      ? "Источник банка отвечает, но контент не виден"
                      : "Банк пока пуст"}
                  text={!vm.coverage.bank
                    ? "Контур жив, но `node_recipes` или связанный read-layer ещё не дают наполнить банк."
                    : bankReadLayerEmpty
                      ? "В clean pod сейчас не видно ни recipe rows, ни `content_assets disk=gen`. Это не normal-happy-empty, а сигнал, что live source пока пуст или скрыт."
                      : "Это штатное пустое состояние: сначала нужно довести ролики до OTK-pass, и тогда они появятся здесь."}
                  tone={!vm.coverage.bank || bankReadLayerEmpty ? "warn" : "neutral"}
                />
                {(bankReadLayerEmpty || !vm.coverage.bank) ? (
                  <>
                    <div className="pc-evidence-grid">
                      <div className="pc-evidence-card">
                        <span className="pc-label">recipes visible</span>
                        <strong>{readEvidence.recipesVisible}</strong>
                      </div>
                      <div className="pc-evidence-card">
                        <span className="pc-label">gen videos visible</span>
                        <strong>{readEvidence.generatedVideosVisible}</strong>
                      </div>
                      <div className="pc-evidence-card">
                        <span className="pc-label">publications visible</span>
                        <strong>{readEvidence.publicationsVisible}</strong>
                      </div>
                    </div>
                    <div className="pc-empty-hint">
                      <div className="pc-label">next action</div>
                      <div className="pc-note">Проверь source feed, потом каналы. Если в `/api/factory/studio` тоже нули, проблема не в UI, а в видимости live data для clean pod.</div>
                    </div>
                  </>
                ) : null}
                {(!vm.coverage.bank || bankReadLayerEmpty) ? (
                  <div className="pc-action-row" style={{ marginTop: 14 }}>
                    <button className="pc-primary ghost" onClick={refresh}>Повторить</button>
                    <button className="pc-primary ghost" onClick={() => setScreen("channels")}>Открыть каналы</button>
                    <button className="pc-primary ghost" onClick={() => window.open("/api/factory/studio", "_blank", "noopener,noreferrer")}>Открыть source feed</button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className={`pc-bank-layout ${bankView}`}>
                {bankFiltered.map((item) => (
                  <article key={item.id} className={`pc-card pc-bank-card ${selBank === item.id ? "selected" : ""}`} onClick={() => setSelBank(item.id)}>
                    <div className={`pc-bank-poster ${bankPosterTone(item)} ${item.stream}`}>
                      <div className="pc-bank-poster-top">
                        <span className={`pc-bank-score ${item.otkScore != null && item.otkScore >= 5 ? "ok" : "warn"}`}>
                          OTK {item.otkScore == null ? "—" : Math.round(item.otkScore)}
                        </span>
                        <span className={`pc-bank-mini-state ${statusTone(item.status)}`}>{bankStatusLabel(item)}</span>
                      </div>
                      <div className="pc-bank-poster-bottom">
                        <span className="pc-bank-poster-tag">{item.stream}</span>
                        <PlayCircle size={14} />
                      </div>
                    </div>
                    <div className="pc-bank-card-body">
                      <div className="pc-bank-top">
                        <div>
                          <div className="pc-bank-article">{item.article}</div>
                          <div className="pc-bank-title">{item.title}</div>
                        </div>
                      </div>
                      <div className="pc-bank-meta-row">
                        <span className="pc-bank-chip">{item.targetPlatform}</span>
                        <span className="pc-bank-chip">{item.format}</span>
                      </div>
                      <div className="pc-bank-meta">{item.niche}</div>
                      <div className="pc-bank-meta">{item.published.length ? `Опубликовано: ${item.published.join(", ")}` : "Нигде не публиковалось"}</div>
                      <div className="pc-bank-meta">{item.outputUrl ? "Output ready · publish path открыт" : "Output missing · publish path закрыт"}</div>
                      {item.needsUniqueVariant ? <div className="pc-bank-warning">Нужен unique-вариант под соц-аккаунт</div> : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
          {renderInspector()}
        </section>
      );
    }

    if (screen === "calendar") {
      const calendarLockedCount = vm.calendar.filter((slot) => slot.complianceLocked || slot.state === "locked").length;
      const calendarPublishingCount = vm.calendar.filter((slot) => slot.state === "publishing").length;
      const calendarPublishedCount = vm.calendar.filter((slot) => slot.state === "published").length;
      const calendarOpenCount = vm.calendar.filter((slot) => !slot.complianceLocked && slot.state !== "published").length;
      return (
        <section className="pc-grid pc-grid-shell">
          <section className="pc-card pc-span-main">
            <div className="pc-card-head">
              <div>
                <div className="pc-title">Календарь слотов</div>
                <div className="pc-sub">scheduled / locked / published</div>
              </div>
            </div>
            <div className="pc-summary-band">
              <div className="pc-summary-stat">
                <span className="pc-label">open</span>
                <strong>{fmtNumber(calendarOpenCount)}</strong>
              </div>
              <div className="pc-summary-stat">
                <span className="pc-label">locked</span>
                <strong>{fmtNumber(calendarLockedCount)}</strong>
              </div>
              <div className="pc-summary-stat">
                <span className="pc-label">publishing</span>
                <strong>{fmtNumber(calendarPublishingCount)}</strong>
              </div>
              <div className="pc-summary-stat">
                <span className="pc-label">published</span>
                <strong>{fmtNumber(calendarPublishedCount)}</strong>
              </div>
            </div>
            {!vm.calendar.length ? (
              <EmptyInline text={vm.coverage.calendar
                ? "Сетка пока пустая. Это expected состояние для старта: отсюда будет видно, какие каналы ещё без каденса."
                : "Календарь в partial-live режиме: `factory_publications` не читается, поэтому слоты пока не из чего собрать."} />
            ) : (
              <div className="pc-calendar-list">
                {vm.calendar.map((slot) => (
                  <button key={slot.id} className={`pc-slot pc-slot-card pc-slot-button ${slot.complianceLocked ? "locked" : ""} ${selCalendar === slot.id ? "selected" : ""}`} onClick={() => setSelCalendar(slot.id)}>
                    <div className="pc-slot-main">
                      <div className="pc-run-card-top">
                        <span className="pc-bank-chip">{slot.platform}</span>
                        <div className="pc-list-title">{slot.article}</div>
                      </div>
                      <div className="pc-run-card-meta">
                        <span>{slot.day}</span>
                        <span>{slot.group}</span>
                        {slot.time ? <span>{slot.time}</span> : null}
                      </div>
                    </div>
                    <div className="pc-slot-side">
                      {slot.complianceLocked ? <Lock size={14} /> : null}
                      <span className={`pc-pill ${statusTone(slot.state)}`}>{slot.state}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
          {renderInspector()}
        </section>
      );
    }

    if (screen === "fleet") {
      const groups = fleetGroupBy === "stream"
        ? [{ label: "Product", items: vm.fleet.filter((item) => item.stream === "product") }, { label: "Manya", items: vm.fleet.filter((item) => item.stream === "manya") }]
        : [{ label: "All accounts", items: vm.fleet }];
      const fleetActiveCount = vm.fleet.filter((item) => item.health === "active").length;
      const fleetWarmupCount = vm.fleet.filter((item) => item.health === "warming" || item.warmup === "warming" || item.warmup === "cold").length;
      const fleetBannedCount = vm.fleet.filter((item) => item.health === "banned").length;
      const fleetNeedsLoginCount = vm.fleet.filter((item) => item.health === "needs-login" || item.session === false).length;
      return (
        <section className="pc-grid pc-grid-shell">
          <section className="pc-card pc-span-main">
            <div className="pc-card-head">
              <div>
              <div className="pc-title">Флот аккаунтов</div>
                <div className="pc-sub">здоровье, прогрев, proxy sid и box</div>
              </div>
              <div className="pc-chipset">
                <button className={`pc-chip ${fleetGroupBy === "stream" ? "active" : ""}`} onClick={() => setFleetGroupBy("stream")}>grouped</button>
                <button className={`pc-chip ${fleetGroupBy === "flat" ? "active" : ""}`} onClick={() => setFleetGroupBy("flat")}>flat</button>
                <button className="pc-primary ghost" onClick={() => setWizardOpen(true)}><MonitorSmartphone size={13} /> завести</button>
              </div>
            </div>
            <div className="pc-summary-band">
              <div className="pc-summary-stat">
                <span className="pc-label">active</span>
                <strong>{fmtNumber(fleetActiveCount)}</strong>
              </div>
              <div className="pc-summary-stat">
                <span className="pc-label">warmup</span>
                <strong>{fmtNumber(fleetWarmupCount)}</strong>
              </div>
              <div className="pc-summary-stat">
                <span className="pc-label">banned</span>
                <strong>{fmtNumber(fleetBannedCount)}</strong>
              </div>
              <div className="pc-summary-stat">
                <span className="pc-label">needs login</span>
                <strong>{fmtNumber(fleetNeedsLoginCount)}</strong>
              </div>
            </div>
            {fleetBannedCount > 0 ? (
              <div className="pc-fleet-alert">
                <Ban size={14} />
                <span>{fleetBannedCount} аккаунт{fleetBannedCount === 1 ? "" : fleetBannedCount < 5 ? "а" : "ов"} в бане или challenge state, сначала разрули их перед новым залпом.</span>
              </div>
            ) : null}
            {!vm.fleet.length ? (
              <EmptyInline text={vm.coverage.fleet
                ? "Флот пока не заведён. Пустой сценарий поддержан: можно начинать с нескольких облачных API-аккаунтов и постепенно добавлять браузерные."
                : "Флот в partial-live режиме: `factory_distribution_targets` пока недоступна, поэтому health/proxy/account state неоткуда собрать."} />
            ) : groups.map((group) => (
              <div key={group.label} className="pc-group-block">
                <div className="pc-group-title">{group.label}</div>
                <div className="pc-fleet-table">
                  <div className="pc-fleet-head">
                    <span>Account</span>
                    <span>Stream</span>
                    <span>Warmup</span>
                    <span>Health</span>
                    <span>Proxy</span>
                    <span>Limit</span>
                    <span>Last post</span>
                    <span>Box</span>
                    <span>Session</span>
                  </div>
                  {group.items.map((acct) => (
                    <button key={acct.id} className={`pc-row-button pc-fleet-row ${selFleet === acct.id ? "selected" : ""}`} onClick={() => setSelFleet(acct.id)}>
                      <div className="pc-fleet-ident">
                        <strong>{acct.handle}</strong>
                        <span className="pc-bank-chip">{acct.platform}</span>
                      </div>
                      <div className="pc-fleet-stream pc-mono">{acct.stream}</div>
                      <div className="pc-fleet-warmup">
                        <span className={`pc-pill ${statusTone(acct.warmup)}`}>{warmupLabel(acct.warmup)}</span>
                        <div className="pc-fleet-bar"><span style={{ width: `${Math.round(warmupProgress(acct.warmup) * 100)}%` }} /></div>
                      </div>
                      <div className="pc-fleet-health">
                        <span className={`pc-dot ${statusTone(acct.health)}`} />
                        <span>{fleetHealthLabel(acct.health)}</span>
                      </div>
                      <div className="pc-fleet-proxy">
                        <span className="pc-mono">{acct.proxyKind || "cloud"}</span>
                        <span className="pc-fleet-dim pc-mono">{acct.proxySid || "no sid"}</span>
                      </div>
                      <div className="pc-fleet-limit">
                        <span className="pc-mono">{acct.posts ?? 0}/{acct.cap ?? "—"}</span>
                        <div className="pc-fleet-bar"><span style={{ width: `${acct.cap ? Math.min(100, Math.round(((acct.posts ?? 0) / acct.cap) * 100)) : 0}%` }} /></div>
                      </div>
                      <div className="pc-fleet-dim pc-mono">{fmtAgo(acct.lastPost)}</div>
                      <div className="pc-fleet-dim pc-mono">{acct.box}</div>
                      <div className="pc-fleet-session">
                        <span className={`pc-fleet-session-dot ${acct.session == null ? "" : acct.session ? "ok" : "err"}`} title={acct.session == null ? "unknown" : acct.session ? "session alive" : "session dead"} />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
          {renderInspector()}
        </section>
      );
    }

    if (screen === "runs") {
      const runLiveCount = runsFiltered.filter((run) => run.status === "publishing").length;
      const runFailedCount = runsFiltered.filter((run) => run.status === "failed").length;
      const runScheduledCount = runsFiltered.filter((run) => run.status === "scheduled").length;
      const runRetryCount = runsFiltered.filter((run) => run.reason || run.status === "failed").length;
      return (
        <section className="pc-grid pc-grid-shell">
          <section className="pc-card pc-span-main">
            <div className="pc-card-head">
              <div>
                <div className="pc-title">Прогоны публикации</div>
                <div className="pc-sub">uploading / moderation / failed / retrying</div>
              </div>
              <div className="pc-chipset">
                <button className={`pc-chip ${runFilter === "all" ? "active" : ""}`} onClick={() => setRunFilter("all")}>all</button>
                <button className={`pc-chip ${runFilter === "publishing" ? "active" : ""}`} onClick={() => setRunFilter("publishing")}>live</button>
                <button className={`pc-chip ${runFilter === "failed" ? "active" : ""}`} onClick={() => setRunFilter("failed")}>failed</button>
                <button className={`pc-chip ${runFilter === "scheduled" ? "active" : ""}`} onClick={() => setRunFilter("scheduled")}>scheduled</button>
              </div>
            </div>
            <div className="pc-summary-band">
              <div className="pc-summary-stat">
                <span className="pc-label">live now</span>
                <strong>{fmtNumber(runLiveCount)}</strong>
              </div>
              <div className="pc-summary-stat">
                <span className="pc-label">failed</span>
                <strong>{fmtNumber(runFailedCount)}</strong>
              </div>
              <div className="pc-summary-stat">
                <span className="pc-label">scheduled</span>
                <strong>{fmtNumber(runScheduledCount)}</strong>
              </div>
              <div className="pc-summary-stat">
                <span className="pc-label">needs retry</span>
                <strong>{fmtNumber(runRetryCount)}</strong>
              </div>
            </div>
            {!runsFiltered.length ? (
              <EmptyInline text={vm.coverage.runs
                ? "Активных прогонов нет. Здесь же будет видно частичное состояние, когда API-каналы живы, а browser fleet встал."
                : "Прогоны сейчас не читаются из источника публикаций, поэтому экран остаётся в monitoring-ready режиме без live очереди."} />
            ) : (
              <div className="pc-run-list">
                {runsFiltered.map((run) => (
                  <button key={run.id} className={`pc-run-card pc-row-button ${selRun === run.id ? "selected" : ""}`} onClick={() => setSelRun(run.id)}>
                    <div className="pc-run-card-main">
                      <div className="pc-run-card-top">
                        <span className="pc-bank-chip">{run.platform}</span>
                        <div className="pc-list-title">{run.account} · {run.article}</div>
                      </div>
                      <div className="pc-run-card-meta">
                        <span>{run.stage}</span>
                        {run.reason ? <span>{run.reason}</span> : null}
                        {run.attemptLabel ? <span>{run.attemptLabel}</span> : null}
                        {run.externalId ? <span>{run.externalId}</span> : null}
                      </div>
                      <div className="pc-progress">
                        <span style={{ width: `${Math.round((run.progress || 0) * 100)}%` }} />
                      </div>
                    </div>
                    <div className="pc-run-card-side">
                      <span className={`pc-pill ${statusTone(run.status)}`}>{run.status}</span>
                      <span className="pc-mono">{fmtTimer(run.timerSec)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
          {renderInspector()}
        </section>
      );
    }

    if (screen === "metrics") {
      const metricWinnerCount = metricsFiltered.filter((metric) => metric.status === "winner").length;
      const metricFreshCount = metricsFiltered.filter((metric) => metric.status === "fresh").length;
      const metricWatchMean = metricsFiltered.length
        ? metricsFiltered.reduce((acc, metric) => acc + (metric.watch || 0), 0) / metricsFiltered.length
        : 0;
      const metricOrdersCount = metricsFiltered.reduce((acc, metric) => acc + (metric.orders || 0), 0);
      const metricSalvageableCount = metricsFiltered.filter((metric) => metric.status === "salvageable").length;
      const metricPublishedCount = vm.runs.filter((run) => run.status === "published").length;
      const metricStaleCount = metricsFiltered.filter((metric) => metric.status === "stale").length;
      return (
        <section className="pc-grid pc-grid-shell">
          <div className="pc-card pc-span-main">
            <div className="pc-card-head">
              <div>
                <div className="pc-title">Метрики и победители</div>
                <div className="pc-sub">views / watch / saves / orders</div>
              </div>
              <div className="pc-chipset">
                <button className={`pc-chip ${metricFilter === "all" ? "active" : ""}`} onClick={() => setMetricFilter("all")}>all</button>
                <button className={`pc-chip ${metricFilter === "winner" ? "active" : ""}`} onClick={() => setMetricFilter("winner")}>winner</button>
                <button className={`pc-chip ${metricFilter === "salvageable" ? "active" : ""}`} onClick={() => setMetricFilter("salvageable")}>salvageable</button>
                <button className={`pc-chip ${metricFilter === "fresh" ? "active" : ""}`} onClick={() => setMetricFilter("fresh")}>fresh</button>
              </div>
            </div>
            <div className="pc-metric-strip">
              <div className="pc-metric-strip-item"><strong>{fmtNumber(metricPublishedCount)}</strong><span>Опубликовано</span></div>
              <div className="pc-metric-strip-item"><strong>{fmtNumber(metricFreshCount)}</strong><span>Собирают</span></div>
              <div className="pc-metric-strip-item"><strong>{fmtNumber(metricWinnerCount)}</strong><span>Победителей</span></div>
              <div className="pc-metric-strip-item"><strong>{fmtNumber(metricSalvageableCount)}</strong><span>Спасаемых</span></div>
              <div className="pc-metric-strip-item"><strong>{fmtNumber(metricStaleCount)}</strong><span>Устарело &gt; 7д</span></div>
              <div className="pc-metric-strip-item"><strong>{fmtPct(metricWatchMean)}</strong><span>Avg watch</span></div>
              <div className="pc-metric-strip-item"><strong>{fmtNumber(metricOrdersCount)}</strong><span>Orders</span></div>
            </div>
          </div>
          {!metricsFiltered.length ? (
            <div className="pc-card pc-span-main">
              <EmptyStatePanel
                eyebrow={!vm.coverage.metrics ? "metrics degraded" : marketReadLayerEmpty ? "market loop waiting" : "no metrics yet"}
                title={!vm.coverage.metrics
                  ? "Рынок пока в degraded read-mode"
                  : marketReadLayerEmpty
                    ? "Петля рынка подключена, но данных ещё нет"
                    : "Метрики ещё не пришли"}
                text={!vm.coverage.metrics
                  ? "Таблица `post_metrics` отвечает не в полном контракте, поэтому winners loop ещё без полного payload."
                  : marketReadLayerEmpty
                    ? "Read-layer рынка отвечает, но в clean pod пока не видно ни одной строки `post_metrics`. Публикация уже может жить, но real market loop ещё без данных."
                    : "Это нормальное стартовое состояние: публикации уже можно вести, а реальные `post_metrics` подтянутся после первых publish/poll циклов."}
                tone={!vm.coverage.metrics || marketReadLayerEmpty ? "warn" : "neutral"}
              />
              {(marketReadLayerEmpty || !vm.coverage.metrics) ? (
                <>
                  <div className="pc-evidence-grid">
                    <div className="pc-evidence-card">
                      <span className="pc-label">metrics visible</span>
                      <strong>{readEvidence.metricsVisible}</strong>
                    </div>
                    <div className="pc-evidence-card">
                      <span className="pc-label">publications visible</span>
                      <strong>{readEvidence.publicationsVisible}</strong>
                    </div>
                    <div className="pc-evidence-card">
                      <span className="pc-label">targets visible</span>
                      <strong>{readEvidence.targetsVisible}</strong>
                    </div>
                  </div>
                  <div className="pc-empty-hint">
                    <div className="pc-label">next action</div>
                    <div className="pc-note">Открой learning feed и проверь, появились ли winners/presets. Если там нули, market loop честно живёт в ожидании первых реальных публикаций.</div>
                  </div>
                </>
              ) : null}
              <div className="pc-action-row" style={{ marginTop: 14 }}>
                <button className="pc-primary ghost" onClick={refresh}>Обновить read-layer</button>
                <button className="pc-primary ghost" onClick={() => setScreen("channels")}>Проверить каналы</button>
                <button className="pc-primary ghost" onClick={() => window.open("/api/factory/learning", "_blank", "noopener,noreferrer")}>Открыть learning feed</button>
              </div>
            </div>
          ) : (
            <div className="pc-card pc-span-main">
              <div className="pc-metric-board">
                <div className="pc-metric-head">
                  <span>Пост</span>
                  <span>Просмотры</span>
                  <span>Watch</span>
                  <span>Saves</span>
                  <span>Orders</span>
                  <span>Revenue</span>
                  <span>Статус</span>
                </div>
                <div className="pc-metric-list">
                  {metricsFiltered.map((metric) => (
                    <article key={metric.id} className={`pc-metric-card pc-metric-row ${selMetric === metric.id ? "selected" : ""}`} onClick={() => setSelMetric(metric.id)}>
                      <div className="pc-metric-table">
                        <div className="pc-metric-post">
                          <div className="pc-metric-post-head">
                            <span className={`pc-metric-thumb ${metricThumbTone(metric)}`} />
                            <div className="pc-metric-post-copy">
                              <span className="pc-bank-chip">{metric.platform}</span>
                              <div className="pc-bank-article">{metric.article}</div>
                              <div className="pc-bank-meta">{fmtAgo(metric.postedAt)}</div>
                            </div>
                          </div>
                        </div>
                        <div className="pc-metric-views">
                          <strong>{fmtViewsCompact(metric.views)}</strong>
                          <div className="pc-curve pc-curve-inline">{curveBars(metric.curve)}</div>
                        </div>
                        <div className="pc-metric-cell">{fmtPct(metric.watch)}</div>
                        <div className="pc-metric-cell">{fmtNumber(metric.saves)}</div>
                        <div className="pc-metric-cell">{fmtNumber(metric.orders)}</div>
                        <div className="pc-metric-cell">{metric.revenue == null ? "—" : fmtCompactMoney(metric.revenue)}</div>
                        <div className="pc-metric-status-cell">
                          <span className={`pc-pill ${statusTone(metric.status)}`}>{metricStatusLabel(metric.status)}</span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          )}
          <section className="pc-card pc-span-main">
            <div className="pc-card-head">
              <div>
                <div className="pc-title">Next Cycle</div>
                <div className="pc-sub">что рынок уже вернул в improvement loop за последние 7 дней</div>
              </div>
              <span className={`pc-pill ${improvementLoop.ready ? "ok" : "warn"}`}>{improvementLoop.ready ? "ready" : "partial"}</span>
            </div>
            <div className="pc-grid pc-grid-3">
              <article className="pc-card pc-mini-card">
                <div className="pc-bank-top">
                  <div>
                    <div className="pc-bank-title">Loop summary</div>
                    <div className="pc-bank-meta">{improvementLoop.niche || "winner niche pending"}</div>
                  </div>
                  <span className={`pc-pill ${improvementLoop.ready ? "ok" : "warn"}`}>{improvementLoop.winners7d} winners</span>
                </div>
                <div className="pc-state-line"><span className="pc-label">winner presets</span><span>{improvementLoop.winnerPresets}</span></div>
                <div className="pc-state-line"><span className="pc-label">signals 7d</span><span>{fmtNumber(learningData?.signals?.total || 0)}</span></div>
                <div className="pc-note">{improvementLoop.nextStep}</div>
                {improvementLoop.learningHints ? <div className="pc-note">{improvementLoop.learningHints}</div> : null}
              </article>
              <article className="pc-card pc-mini-card">
                <div className="pc-bank-top">
                  <div>
                    <div className="pc-bank-title">Top winner hook</div>
                    <div className="pc-bank-meta">{topLoopNiche?.niche || "no niche yet"}</div>
                  </div>
                  <span className="pc-pill ok">{topLoopNiche?.count || 0} hooks</span>
                </div>
                {topLoopNiche?.top?.length ? (
                  <>
                    <div className="pc-note">“{topLoopNiche.top[0].hook}”</div>
                    <div className="pc-state-line"><span className="pc-label">score</span><span>{topLoopNiche.top[0].score}/5</span></div>
                    <div className="pc-note">{topLoopNiche.top[0].note}</div>
                  </>
                ) : (
                  <div className="pc-note">Пока нет накопленного hook corpus по winner-нише.</div>
                )}
              </article>
              <article className="pc-card pc-mini-card">
                <div className="pc-bank-top">
                  <div>
                    <div className="pc-bank-title">What factory learned</div>
                    <div className="pc-bank-meta">rejects / presets / winners</div>
                  </div>
                  <span className="pc-pill warn">{fmtNumber(learningSignals.winners || 0)} winner marks</span>
                </div>
                <div className="pc-state-line"><span className="pc-label">winner presets</span><span>{learningPresets.length}</span></div>
                <div className="pc-state-line"><span className="pc-label">hook chosen</span><span>{fmtNumber(learningSignals.hook_chosen || 0)}</span></div>
                <div className="pc-state-line"><span className="pc-label">rejected</span><span>{fmtNumber(learningSignals.rejected || 0)}</span></div>
                {topRejectReason ? <div className="pc-note">Анти-паттерн недели: {topRejectReason.reason} · {topRejectReason.n}</div> : <div className="pc-note">Топ reject reason пока не накоплен.</div>}
              </article>
            </div>
          </section>
          {metricSelected ? (
            <aside className="pc-card pc-inspector pc-metric-aside">
              <div className="pc-metric-aside-top">
                <span className="pc-bank-chip">{metricSelected.platform}</span>
                <span className="pc-mono">{metricSelected.article}</span>
              </div>
              <div className="pc-metric-curve-box">
                <div className="pc-bank-top">
                  <span className="pc-label">Кривая до 5000</span>
                  <span className={`pc-pill ${statusTone(metricSelected.status)}`}>{metricStatusLabel(metricSelected.status)}</span>
                </div>
                <div className="pc-curve pc-curve-tall">{curveBars(metricSelected.curve)}</div>
                <div className="pc-state-line">
                  <span className="pc-note">порог победителя · 5000</span>
                  <span className="pc-metric-curve-value">{fmtViewsCompact(metricSelected.views)}</span>
                </div>
              </div>
              <div className="pc-improvement-box">
                <div className="pc-state-line"><span className="pc-label">Опубликовано</span><span>{fmtNumber(vm.runs.filter((run) => run.status === "published").length)}</span></div>
                <div className="pc-state-line"><span className="pc-label">Собирают</span><span>{fmtNumber(metricFreshCount)}</span></div>
                <div className="pc-state-line"><span className="pc-label">Победителей</span><span>{fmtNumber(metricWinnerCount)}</span></div>
                <div className="pc-state-line"><span className="pc-label">Спасаемых</span><span>{fmtNumber(metricSalvageableCount)}</span></div>
                <div className="pc-state-line"><span className="pc-label">Revenue</span><span>{metricSelected.revenue == null ? "—" : fmtCompactMoney(metricSelected.revenue)}</span></div>
              </div>
              <div className="pc-poll-banner">
                Опрос {metricSelected.status === "winner" ? "активен" : "доступен"} · кривая {metricSelected.views >= 5000 ? "достигла порога" : "растёт"}
              </div>
              {metricSelected.status === "winner" ? (
                <div className="pc-metric-winner-box">
                  <div className="pc-bank-title">Победитель</div>
                  <div className="pc-note">Хук ушёл в банк, winner-presets обновлены, improvement loop уже использует этот результат.</div>
                </div>
              ) : null}
              <div className="pc-improvement-box">
                <div className="pc-state-line"><span className="pc-label">Saves</span><span>{fmtNumber(metricSelected.saves)}</span></div>
                <div className="pc-state-line"><span className="pc-label">Orders</span><span>{fmtNumber(metricSelected.orders)}</span></div>
                <div className="pc-state-line"><span className="pc-label">publication id</span><span className="pc-mono">{metricSelected.publicationId || "—"}</span></div>
                <div className="pc-state-line"><span className="pc-label">external post</span><span className="pc-mono">{metricSelected.externalPostId || "—"}</span></div>
              </div>
              <div className="pc-action-col">
                <button
                  className="pc-primary"
                  onClick={() => window.open(runSelected?.publishedUrl || "#", "_blank", "noopener,noreferrer")}
                  disabled={!runSelected?.publishedUrl}
                >
                  Открыть пост
                </button>
                <button
                  className="pc-primary ghost"
                  onClick={() => openMarketLoop({
                    recipeId: metricSelected.recipeId,
                    publicationId: metricSelected.publicationId,
                    externalPostId: metricSelected.externalPostId,
                    platform: metricSelected.platform,
                    article: metricSelected.article,
                  }, "pull_live")}
                >
                  Опросить сейчас
                </button>
              </div>
            </aside>
          ) : null}
        </section>
      );
    }

    if (screen === "channels") {
      const wave1 = statusData?.publication_wave1 || null;
      const wave1Pending = (statusData?.pending || []).filter((item) =>
        item.includes("SUPABASE_SERVICE_ROLE_KEY")
        || item.includes("FACTORY_PINTEREST_ACCESS_TOKEN")
        || item.includes("factory_publications")
        || item.includes("factory_distribution_targets")
      );
      return (
        <section className="pc-grid pc-grid-shell">
          {wave1 ? (
            <section className="pc-card pc-span-main">
              <div className="pc-card-head">
                <div>
                  <div className="pc-title">Wave-1 readiness</div>
                  <div className="pc-sub">что уже живо в clean pod, а что ещё блокирует full loop</div>
                </div>
              </div>
              <div className="pc-grid pc-grid-3">
                <article className="pc-card pc-mini-card">
                  <div className="pc-bank-top">
                    <div>
                      <div className="pc-bank-title">Telegram</div>
                      <div className="pc-bank-meta">cloud publish · no browser</div>
                    </div>
                    <span className={`pc-pill ${wave1.telegram_bot && wave1.telegram_chat ? "ok" : "warn"}`}>{wave1.telegram_bot && wave1.telegram_chat ? "live" : "blocked"}</span>
                  </div>
                  <div className="pc-bank-meta">bot token: {wave1.telegram_bot ? "ready" : "missing"}</div>
                  <div className="pc-bank-meta">owner chat: {wave1.telegram_chat ? "ready" : "missing"}</div>
                  <div className="pc-note">Живой smoke publish уже подтверждён через clean pod.</div>
                </article>
                <article className="pc-card pc-mini-card">
                  <div className="pc-bank-top">
                    <div>
                      <div className="pc-bank-title">Pinterest</div>
                      <div className="pc-bank-meta">publish + analytics</div>
                    </div>
                    <span className={`pc-pill ${wave1.pinterest_token ? "ok" : "warn"}`}>{wave1.pinterest_token ? "ready" : "token missing"}</span>
                  </div>
                  <div className="pc-bank-meta">access token: {wave1.pinterest_token ? "present" : "missing"}</div>
                  <div className="pc-bank-meta">native metrics pull: adapter ready</div>
                  <div className="pc-note">Последний реальный блокер wave-1 publish/analytics для Pinterest — отсутствующий token.</div>
                </article>
                <article className="pc-card pc-mini-card">
                  <div className="pc-bank-top">
                    <div>
                      <div className="pc-bank-title">Persist layer</div>
                      <div className="pc-bank-meta">publication rows + market loop writes</div>
                    </div>
                    <span className={`pc-pill ${wave1.supabase_write && wave1.tables.factory_publications && wave1.tables.factory_distribution_targets ? "ok" : "warn"}`}>{wave1.supabase_write ? "partial write" : "read-only"}</span>
                  </div>
                  <div className="pc-bank-meta">service role: {wave1.supabase_write ? "present" : "missing"}</div>
                  <div className="pc-bank-meta">factory_publications: {wave1.tables.factory_publications ? "present" : "missing"}</div>
                  <div className="pc-bank-meta">distribution_targets: {wave1.tables.factory_distribution_targets ? "present" : "missing"}</div>
                </article>
              </div>
              {wave1Pending.length ? (
                <div className="pc-checklist" style={{ marginTop: 14 }}>
                  {wave1Pending.map((item) => (
                    <div key={item} className="pc-note">{item}</div>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
          {!vm.channels.length ? (
            <div className="pc-card pc-span-main">
              <EmptyInline text="Каналы ещё не заведены. Тут же будут видны token-missing, transport-unconfirmed и compliance-block состояния." />
            </div>
          ) : (
            <div className="pc-channel-list pc-span-main">
              {vm.channels.map((channel) => (
                <article key={channel.id} className={`pc-card pc-channel-card pc-channel-row ${selChannel === channel.id ? "selected" : ""}`} onClick={() => setSelChannel(channel.id)}>
                  <div className="pc-bank-top">
                    <div>
                      <div className="pc-bank-title">{channel.name}</div>
                      <div className="pc-bank-meta">{channel.runsOn} · {capabilityLabel(channel)}</div>
                    </div>
                    <span className={`pc-pill ${statusTone(channel.status)}`}>{channel.status}</span>
                  </div>
                  <div className="pc-channel-row-meta">
                    <span className="pc-bank-chip">{channel.transport === "api" ? "API" : channel.transport === "browser" ? "Browser" : "TBD"}</span>
                    <span className="pc-bank-meta">Аккаунтов: {channel.accounts}</span>
                    <span className="pc-bank-meta">Тревог: {channel.alerts}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
          {renderInspector()}
        </section>
      );
    }

    return (
        <section className="pc-grid pc-grid-shell">
          <section className="pc-card pc-span-main">
            <div className="pc-card-head">
              <div>
                <div className="pc-title">Тревоги и сбои</div>
                <div className="pc-sub">очередь действий с evidence</div>
              </div>
            </div>
            <div className="pc-summary-band">
              <div className="pc-summary-stat">
                <span className="pc-label">total</span>
                <strong>{fmtNumber(alertsFiltered.length)}</strong>
              </div>
              <div className="pc-summary-stat">
                <span className="pc-label">critical</span>
                <strong>{fmtNumber(alertsFiltered.filter((alert) => alert.severity === "err").length)}</strong>
              </div>
              <div className="pc-summary-stat">
                <span className="pc-label">warnings</span>
                <strong>{fmtNumber(alertsFiltered.filter((alert) => alert.severity === "warn").length)}</strong>
              </div>
              <div className="pc-summary-stat">
                <span className="pc-label">accounts hit</span>
                <strong>{fmtNumber(new Set(alertsFiltered.map((alert) => alert.account)).size)}</strong>
              </div>
            </div>
          {!alertsFiltered.length ? (
            <EmptyInline text="Список тревог пуст. Это healthy-state: можно переключиться на bank и metrics." />
          ) : (
            <div className="pc-run-list">
              {alertsFiltered.map((alert) => (
                <button key={alert.id} className={`pc-alert-card pc-row-button ${alert.severity} ${selAlert === alert.id ? "selected" : ""}`} onClick={() => setSelAlert(alert.id)}>
                  <div className="pc-run-card-main">
                    <div className="pc-run-card-top">
                      <span className="pc-bank-chip">{alert.channel}</span>
                      <div className="pc-list-title">{alert.title}</div>
                    </div>
                    <div className="pc-run-card-meta">
                      <span>{alert.account}</span>
                      <span>{fmtAgo(alert.time)}</span>
                      <span>{alert.kind}</span>
                    </div>
                    <div className="pc-note pc-note-clamp">{alert.evidence}</div>
                  </div>
                  <div className="pc-run-card-side">
                    <span className={`pc-pill ${statusTone(alert.severity)}`}>{alert.severity}</span>
                    <ChevronRight size={14} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
        {renderInspector()}
      </section>
    );
  }

  const alertCount = alertsFiltered.length;
  const topWarnings = vm?.warnings?.slice(0, 3) || [];
  const workerTitle = workerLabel(vm?.worker.state || "unknown", Boolean(vm?.worker.online));
  const channelPreview = (vm?.channels || []).slice(0, 3);
  return (
    <div className="pc-root">
      <div className="pc-shell">
        <aside className="pc-rail">
          <div className="pc-rail-head">
            <div className="pc-rail-logo">
              <Send size={15} strokeWidth={2.2} />
            </div>
            <div className="pc-rail-brand">
              <span className="pc-rail-kicker">INFERNO</span>
              <strong>Контент-завод</strong>
            </div>
          </div>
          <div className="pc-rail-group">
            <div className="pc-rail-item"><span>Content studio</span></div>
            <div className="pc-rail-item"><span>UGC studio</span></div>
            <div className="pc-rail-item active"><span>Publication</span></div>
          </div>
          <button className="pc-scenario-pill" onClick={() => { setScreen("overview"); setDemoState("salvo"); pushToast("info", "Сценарий A–E: включён demo salvo flow"); }}>
            <PlayCircle size={16} />
            <span>Сценарии A–E</span>
          </button>
          <div className="pc-rail-foot">
            <span>ОПЕРАТОР ФЛОТА</span>
            <strong>split-brain · cloud + local</strong>
          </div>
        </aside>

        <main className="pc-main">
          <header className="pc-header">
            <div className="pc-title-block">
              <span className="pc-header-title">{activeTab.label}</span>
              <span className="pc-header-sub">{activeTab.subtitle}</span>
            </div>

            <div className="pc-header-actions">
              <div className="pc-segment">
                {(["all", "product", "manya"] as StreamKey[]).map((item) => (
                  <button key={item} className={stream === item ? "active" : ""} onClick={() => setStream(item)}>
                    {item === "all" ? "Все" : item === "product" ? "Товарный" : "Маня"}
                  </button>
                ))}
              </div>

              <div className={`pc-worker ${vm?.worker.online ? "ok" : "warn"}`}>
                {vm?.worker.online ? <CheckCircle2 size={14} /> : <WifiOff size={14} />}
                <span>{vm?.worker.online ? "Воркер онлайн" : workerTitle}</span>
              </div>

              <button className="pc-alert-badge" onClick={() => setScreen("alerts")}>
                <AlertTriangle size={14} />
                <span>{alertCount}</span>
              </button>

              <button className="pc-refresh" onClick={refresh}>
                <RefreshCw size={15} className={loading ? "spin" : ""} />
              </button>
            </div>
          </header>

          <div className="pc-tab-grid">
            {TABS.map((tab) => {
              const count = tab.id === "alerts" ? alertCount : null;
              return (
                <button key={tab.id} className={`pc-tab ${screen === tab.id ? "active" : ""}`} onClick={() => setScreen(tab.id)}>
                  <span>{tab.label}</span>
                  {count ? <span className="pc-tab-count">{count}</span> : null}
                </button>
              );
            })}
          </div>

          {vm?.configured && topWarnings.length ? (
            <div className="pc-warning-strip">
              <Ban size={14} />
              <div className="pc-warning-copy">
                <strong>Read-layer требует внимания</strong>
                <span>{topWarnings[0]}</span>
              </div>
            </div>
          ) : null}

          <div className="pc-content">
            {renderScreen()}
          </div>
        </main>
      </div>

      <button className="pc-rita-pill" onClick={() => setRitaOpen(true)}>
        <span className="pc-rita-avatar">Р</span>
        <span><strong>Рита</strong><em>ассистент</em></span>
      </button>

      {ritaOpen ? (
        <>
          <div className="pc-overlay" onClick={() => setRitaOpen(false)} />
          <aside className="pc-rita">
            <div className="pc-rita-head">
              <div className="pc-rita-brand">
                <span className="pc-rita-avatar big">Р</span>
                <div>
                  <strong>Рита</strong>
                  <span>ассистент завода · знает всё</span>
                </div>
              </div>
              <button onClick={() => setRitaOpen(false)}><X size={16} /></button>
            </div>

            <div className="pc-rita-body">
              {ritaThread.map((message, index) => (
                <div key={`${message.role}-${index}`} className={`pc-bubble ${message.role}`}>
                  <p>{message.text}</p>
                  {message.action ? (
                    <button className="pc-link" onClick={() => { setScreen(message.action!); setRitaOpen(false); }}>
                      Открыть {TABS.find((tab) => tab.id === message.action)?.label || "экран"}
                    </button>
                  ) : null}
                </div>
              ))}
              <div className="pc-chipset">
                {["Что сейчас требует внимания?", "Сколько готово к выкладке?", "Как здоровье флота?", "Что постится прямо сейчас?", "Кто в победителях?"].map((tip) => (
                  <button key={tip} className="pc-chip" onClick={() => setRitaInput(tip)}>{tip}</button>
                ))}
              </div>
            </div>

            <div className="pc-rita-input">
              <input
                value={ritaInput}
                onChange={(e) => setRitaInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitRita(); }}
                placeholder="Спроси про тревоги, банк, флот, победителей…"
              />
              <button onClick={submitRita}><Send size={15} /></button>
            </div>
          </aside>
        </>
      ) : null}

      <div className="pc-toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className={`pc-toast ${toast.kind}`}>
            {toast.kind === "ok" ? <CheckCircle2 size={14} /> : toast.kind === "err" ? <ShieldAlert size={14} /> : <Loader2 size={14} />}
            <span>{toast.text}</span>
          </div>
        ))}
      </div>

      {publishOpen ? (
        <>
          <div className="pc-overlay" onClick={() => setPublishOpen(false)} />
          <div className="pc-modal">
            <div className="pc-card-head">
              <div>
                <div className="pc-title">Публикация wave-1</div>
                <div className="pc-sub">{bankSelected?.article || "—"} · {bankSelected?.title || "контент из банка"}</div>
              </div>
              <button className="pc-refresh" onClick={() => setPublishOpen(false)}><X size={14} /></button>
            </div>
            <div className="pc-wizard-grid">
              <label className="pc-form-field">
                <span className="pc-label">platform</span>
                <select value={publishForm.platform} onChange={(e) => setPublishForm((current) => ({ ...current, platform: e.target.value as "pinterest" | "telegram" }))}>
                  <option value="pinterest">Pinterest</option>
                  <option value="telegram">Telegram</option>
                </select>
              </label>
              <label className="pc-form-field">
                <span className="pc-label">video</span>
                <input value={bankSelected?.outputUrl || ""} readOnly />
              </label>
              <label className="pc-form-field pc-form-span-2">
                <span className="pc-label">caption</span>
                <textarea value={publishForm.caption} onChange={(e) => setPublishForm((current) => ({ ...current, caption: e.target.value }))} rows={4} />
              </label>
              <label className="pc-form-field pc-form-span-2">
                <span className="pc-label">hashtags</span>
                <input value={publishForm.hashtags} onChange={(e) => setPublishForm((current) => ({ ...current, hashtags: e.target.value }))} placeholder="#article #wb" />
              </label>
              {publishForm.platform === "pinterest" ? (
                <>
                  <label className="pc-form-field">
                    <span className="pc-label">board id</span>
                    <input value={publishForm.boardId} onChange={(e) => setPublishForm((current) => ({ ...current, boardId: e.target.value }))} placeholder="123456789" />
                  </label>
                  <label className="pc-form-field">
                    <span className="pc-label">cover url</span>
                    <input value={publishForm.coverUrl} onChange={(e) => setPublishForm((current) => ({ ...current, coverUrl: e.target.value }))} placeholder="https://..." />
                  </label>
                </>
              ) : (
                <>
                  <label className="pc-form-field">
                    <span className="pc-label">chat id</span>
                    <input value={publishForm.chatId} onChange={(e) => setPublishForm((current) => ({ ...current, chatId: e.target.value }))} placeholder="-100..." />
                  </label>
                  <label className="pc-form-field">
                    <span className="pc-label">channel username</span>
                    <input value={publishForm.channelUsername} onChange={(e) => setPublishForm((current) => ({ ...current, channelUsername: e.target.value }))} placeholder="@channel_name" />
                  </label>
                </>
              )}
            </div>
            <div className="pc-note">
              {publishForm.platform === "pinterest"
                ? "Для Pinterest сейчас нужен board_id и cover_url. Если access token не настроен в clean pod, вернётся честкий manual-login block."
                : "Для Telegram можно передать chat_id или @channel, но если clean pod уже знает FACTORY_TG_CHAT_ID, publish пойдёт и без ручного ввода. При отсутствии bot token или owner chat вернётся честкий block без ложного успеха."}
            </div>
            {publishResult ? (
              <div className="pc-publish-result">
                <div className="pc-note">{JSON.stringify(publishResult, null, 2)}</div>
              </div>
            ) : null}
            <div className="pc-action-row" style={{ marginTop: 16 }}>
              <button className="pc-primary" disabled={publishBusy || !bankSelected?.outputUrl || (publishForm.platform === "pinterest" && (!publishForm.boardId || !publishForm.coverUrl))} onClick={submitPublish}>
                {publishBusy ? "Публикую..." : "Запустить publish"}
              </button>
              <button className="pc-primary ghost" onClick={() => setPublishOpen(false)}>Закрыть</button>
            </div>
          </div>
        </>
      ) : null}

      {marketOpen ? (
        <>
          <div className="pc-overlay" onClick={() => setMarketOpen(false)} />
          <div className="pc-modal">
            <div className="pc-card-head">
              <div>
                <div className="pc-title">Market loop</div>
                <div className="pc-sub">{marketContext?.article || "—"} · {marketContext?.platform || "platform unknown"}</div>
              </div>
              <button className="pc-refresh" onClick={() => setMarketOpen(false)}><X size={14} /></button>
            </div>
            <div className="pc-wizard-grid">
              <label className="pc-form-field">
                <span className="pc-label">mode</span>
                <select value={marketForm.mode} onChange={(e) => setMarketForm((current) => ({ ...current, mode: e.target.value as "pull_live" | "manual" }))}>
                  <option value="pull_live">pull live</option>
                  <option value="manual">manual push</option>
                </select>
              </label>
              <label className="pc-form-field">
                <span className="pc-label">recipe id</span>
                <input value={marketContext?.recipeId || ""} readOnly />
              </label>
              <label className="pc-form-field">
                <span className="pc-label">publication id</span>
                <input value={marketContext?.publicationId || ""} readOnly />
              </label>
              <label className="pc-form-field">
                <span className="pc-label">external post id</span>
                <input value={marketContext?.externalPostId || ""} readOnly />
              </label>
              {marketForm.mode === "manual" ? (
                <>
                  <label className="pc-form-field">
                    <span className="pc-label">views</span>
                    <input value={marketForm.views} onChange={(e) => setMarketForm((current) => ({ ...current, views: e.target.value }))} placeholder="5000" />
                  </label>
                  <label className="pc-form-field">
                    <span className="pc-label">watch rate</span>
                    <input value={marketForm.watchRate} onChange={(e) => setMarketForm((current) => ({ ...current, watchRate: e.target.value }))} placeholder="0.42" />
                  </label>
                  <label className="pc-form-field">
                    <span className="pc-label">saves</span>
                    <input value={marketForm.saves} onChange={(e) => setMarketForm((current) => ({ ...current, saves: e.target.value }))} placeholder="37" />
                  </label>
                  <label className="pc-form-field">
                    <span className="pc-label">orders</span>
                    <input value={marketForm.orders} onChange={(e) => setMarketForm((current) => ({ ...current, orders: e.target.value }))} placeholder="3" />
                  </label>
                  <label className="pc-form-field pc-form-span-2">
                    <span className="pc-label">revenue</span>
                    <input value={marketForm.revenue} onChange={(e) => setMarketForm((current) => ({ ...current, revenue: e.target.value }))} placeholder="15000" />
                  </label>
                </>
              ) : null}
            </div>
            <div className="pc-note">
              {marketForm.mode === "pull_live"
                ? "Cockpit попробует забрать native metrics через adapter по `publication_id` или `external_post_id`, затем forward-нуть winner payload дальше в improvement loop."
                : "Ручной push сразу отправит реальные цифры в `post-metrics`. Если write-path в clean pod заблокирован, ты увидишь честкий `write_blocked` вместо ложного успеха."}
            </div>
            {marketResult ? (
              <div className="pc-publish-result">
                <div className="pc-note">{JSON.stringify(marketResult, null, 2)}</div>
              </div>
            ) : null}
            <div className="pc-action-row" style={{ marginTop: 16 }}>
              <button className="pc-primary" disabled={marketBusy || !marketContext?.recipeId || (marketForm.mode === "manual" && !marketForm.views.trim())} onClick={submitMarketLoop}>
                {marketBusy ? "Отправляю..." : marketForm.mode === "pull_live" ? "Запустить live poll" : "Запустить manual push"}
              </button>
              <button className="pc-primary ghost" onClick={() => setMarketOpen(false)}>Закрыть</button>
            </div>
          </div>
        </>
      ) : null}

      {wizardOpen ? (
        <>
          <div className="pc-overlay" onClick={() => setWizardOpen(false)} />
          <div className="pc-modal">
            <div className="pc-card-head">
              <div>
                <div className="pc-title">Мастер заведения аккаунта</div>
                <div className="pc-sub">handle → платформа → proxy/fingerprint → box</div>
              </div>
              <button className="pc-refresh" onClick={() => setWizardOpen(false)}><X size={14} /></button>
            </div>
            <div className="pc-wizard-grid">
              <WizardStep index={1} title="Handle" text="Здесь вводится новый handle и поток контента." />
              <WizardStep index={2} title="Platform" text="Выбор product или manya, затем платформа и транспорт." />
              <WizardStep index={3} title="Proxy / FP" text="Проверка proxy_sid и fingerprint перед созданием аккаунта." />
              <WizardStep index={4} title="Box" text="Привязка к cloud / box-1 / box-2; после этого proxy_sid и profile_id становятся read-only." />
            </div>
            <div className="pc-note">Это read-only first pass: мастер уже встроен в UI, но write-path на создание аккаунта пока сознательно не подключён.</div>
          </div>
        </>
      ) : null}

      <style>{`
        .pc-root { min-height: 100vh; background: #0B0D10; color: #EDEFEA; font-family: var(--pc-font-sans), "Space Grotesk", Inter, system-ui, sans-serif; }
        .pc-shell { display: grid; grid-template-columns: 236px minmax(0, 1fr); min-height: 100vh; box-sizing: border-box; }
        .pc-rail { display: flex; flex-direction: column; gap: 3px; padding: 16px 12px; border-right: 1px solid #20252D; background: #0E1116; }
        .pc-rail-head { display: flex; align-items: center; gap: 10px; padding: 4px 8px 16px; }
        .pc-rail-logo { width: 30px; height: 30px; border-radius: 8px; background: #BEF34A; color: #0B0D10; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 8px 24px rgba(0,0,0,.32); }
        .pc-rail-brand { display: flex; flex-direction: column; line-height: 1.15; }
        .pc-rail-kicker { font: 500 9px/1 var(--pc-font-mono), "JetBrains Mono", ui-monospace, monospace; letter-spacing: .14em; color: #838B96; }
        .pc-rail-brand strong { font-size: 14px; font-weight: 600; }
        .pc-rail-group { display: grid; gap: 3px; padding-top: 8px; }
        .pc-rail-item { display: flex; align-items: center; min-height: 58px; padding: 0 18px; border-radius: 14px; border: 1px solid #20252D; background: #12161B; color: #A6ADB6; font-size: 13px; font-weight: 500; box-shadow: none; }
        .pc-rail-item.active { color: #0B0D10; background: #BEF34A; border-color: #BEF34A; }
        .pc-scenario-pill { margin-top: auto; display: inline-flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 14px; border-radius: 14px; border: 1px solid #2A3240; background: #12161B; color: #BEF34A; box-shadow: 0 8px 24px rgba(0,0,0,.4); cursor: pointer; font-size: 12px; font-weight: 600; }
        .pc-scenario-pill:hover { border-color: rgba(190,243,74,.3); }
        .pc-rail-foot { padding: 12px 10px 4px; border-top: 1px solid #161B22; display: grid; gap: 4px; }
        .pc-rail-foot span, .pc-rail-foot strong { font: 500 9px/1.7 var(--pc-font-mono), "JetBrains Mono", ui-monospace, monospace; letter-spacing: .1em; color: #6E757F; text-transform: uppercase; }
        .pc-main { display: flex; flex-direction: column; min-width: 0; }
        .pc-header { display: flex; align-items: center; gap: 16px; padding: 0 22px; height: 54px; background: #0C0F13; }
        .pc-title-block { display: flex; flex-direction: column; line-height: 1.15; min-width: 150px; }
        .pc-header-title { font-size: 15px; font-weight: 600; color: #F4F6F0; }
        .pc-header-sub { font: 500 9.5px/1 var(--pc-font-mono), "JetBrains Mono", ui-monospace, monospace; letter-spacing: .06em; color: #838B96; margin-top: 4px; }
        .pc-label { font: 700 10px/1 var(--pc-font-mono), "JetBrains Mono", ui-monospace, monospace; letter-spacing: .12em; text-transform: uppercase; color: #8B939E; }
        .pc-header-actions, .pc-chipset, .pc-legend, .pc-toolbar, .pc-action-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .pc-header-actions { margin-left: auto; gap: 10px; }
        .pc-segment { display: inline-flex; gap: 3px; padding: 3px; background: #161B22; border: 1px solid #20252D; border-radius: 8px; min-height: auto; }
        .pc-segment button, .pc-refresh, .pc-alert-badge, .pc-link, .pc-tab, .pc-chip, .pc-primary, .pc-search input, .pc-banner select, .pc-rita-input input, .pc-rita-input button, .pc-slot-button, .pc-row-button, .pc-form-field input, .pc-form-field textarea, .pc-form-field select { border: 0; background: transparent; color: inherit; }
        .pc-segment button { padding: 7px 12px; border-radius: 6px; color: #9298A2; font-size: 12px; font-weight: 500; }
        .pc-segment button.active { background: rgba(190,243,74,.12); color: #BEF34A; border: 1px solid rgba(190,243,74,.35); font-weight: 600; }
        .pc-worker, .pc-banner { display: inline-flex; align-items: center; gap: 8px; padding: 0 10px; min-height: 30px; border-radius: 8px; background: #161B22; border: 1px solid #20252D; color: #C7CCC4; }
        .pc-worker { font-size: 12px; }
        .pc-worker.ok { color: #BEF34A; background: rgba(190,243,74,.08); border-color: rgba(190,243,74,.25); padding: 0 14px; }
        .pc-worker.warn { color: #C7CCC4; }
        .pc-alert-badge, .pc-refresh { width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; background: #161B22; border: 1px solid #20252D; cursor: pointer; color: #9298A2; }
        .pc-alert-badge { width: auto; min-width: 42px; padding: 0 10px; gap: 6px; color: #FFB23E; border-color: rgba(255,178,62,.22); background: rgba(255,178,62,.08); }
        .pc-banner strong { font-size: 12px; font-weight: 500; }
        .pc-banner-detail { color: #838B96; font-size: 12px; }
        .pc-tab-grid { display: flex; align-items: center; gap: 3px; padding: 9px 14px; border-bottom: 1px solid #20252D; background: #0C0F13; overflow-x: auto; }
        .pc-tab { display: inline-flex; align-items: center; gap: 8px; min-height: 34px; padding: 0 12px; border-radius: 8px; border: 1px solid #20252D; background: #0E1116; cursor: pointer; white-space: nowrap; color: #9298A2; font-size: 12px; font-weight: 500; }
        .pc-tab.active { background: rgba(190,243,74,.12); color: #BEF34A; border-color: rgba(190,243,74,.35); }
        .pc-tab-count { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: rgba(255,178,62,.14); color: #FFB23E; font: 700 9px/1 var(--pc-font-mono), "JetBrains Mono", ui-monospace, monospace; }
        .pc-warning-strip { display: flex; align-items: center; gap: 11px; margin: 14px 22px 0; padding: 12px 15px; border-radius: 10px; color: #FFB23E; background: rgba(255,178,62,.08); border: 1px solid rgba(255,178,62,.3); font-size: 12.5px; line-height: 1.45; }
        .pc-warning-copy { display: grid; gap: 2px; }
        .pc-warning-copy strong { color: #F2D39D; font-size: 12.5px; font-weight: 600; }
        .pc-content { padding: 22px; min-width: 900px; display: grid; gap: 18px; }
        .pc-grid { display: grid; gap: 12px; }
        .pc-grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .pc-grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .pc-grid-shell { grid-template-columns: minmax(0, 1fr) 340px; align-items: start; }
        .pc-span-main { grid-column: 1; }
        .pc-span-2 { grid-column: span 2; }
        .pc-span-3 { grid-column: span 3; }
        .pc-card, .pc-empty, .pc-skeleton-card { background: #0D1116; border: 1px solid #20252D; border-radius: 22px; padding: 18px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.015); }
        .pc-card p { margin: 0; }
        .pc-skeleton-card { min-height: 160px; background: linear-gradient(90deg, #0E1116 0%, #161B22 40%, #0E1116 100%); background-size: 240% 100%; animation: pulse 1.6s linear infinite; }
        .pc-skeleton-card.tall { min-height: 260px; }
        .pc-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
        .pc-title { font: 700 25px/1.08 var(--pc-font-sans), "Space Grotesk", Inter, sans-serif; color: #F4F6F0; letter-spacing: -.02em; }
        .pc-sub { margin-top: 6px; color: #838B96; font-size: 13px; }
        .pc-overview-main { display: grid; grid-template-columns: 2fr 1fr; gap: 14px; align-items: start; }
        .pc-overview-card { background: #0E1116; border-radius: 10px; padding: 14px 16px; }
        .pc-overview-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
        .pc-overview-kicker { font: 700 10px/1 var(--pc-font-mono), "JetBrains Mono", ui-monospace, monospace; letter-spacing: .14em; color: #6E757F; text-transform: uppercase; }
        .pc-overview-platform { width: 52px; flex: 0 0 auto; font: 700 10px/1.2 var(--pc-font-mono), "JetBrains Mono", ui-monospace, monospace; color: #9298A2; text-transform: uppercase; }
        .pc-overview-run-lead { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .pc-overview-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 30px 10px; text-align: center; color: #9298A2; font-size: 13px; }
        .pc-fleet-alert { margin-bottom: 11px; display: flex; align-items: center; gap: 8px; padding: 8px 11px; border-radius: 8px; background: #241717; border: 1px solid rgba(229,96,79,.3); color: #FF5E5E; font-size: 12px; }
        .pc-kpis { display: grid; grid-template-columns: repeat(6, minmax(132px, 1fr)); gap: 8px; margin-bottom: 12px; }
        .pc-kpi { cursor: pointer; text-align: left; min-height: 92px; background: #0B0F14; padding: 11px 12px 9px; display: grid; gap: 8px; align-content: space-between; border-radius: 12px; }
        .pc-kpi-copy { display: grid; gap: 6px; }
        .pc-kpi-foot { display: flex; align-items: end; justify-content: space-between; gap: 8px; }
        .pc-kpi-row, .pc-bank-top, .pc-slot, .pc-run-row, .pc-list-row, .pc-attention, .pc-alert-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .pc-kpi-value { font: 700 34px/.92 var(--pc-font-sans), "Space Grotesk", Inter, sans-serif; letter-spacing: -.045em; color: #F4F6F0; }
        .pc-kpi-delta { color: #BEF34A; font: 700 10px/1 var(--pc-font-mono), "JetBrains Mono", ui-monospace, monospace; letter-spacing: .08em; padding-bottom: 1px; }
        .pc-spark { width: 64px; height: 16px; flex: 0 0 auto; }
        .pc-spark path { stroke: #BEF34A; fill: none; strokeWidth: 2; }
        .pc-run-row, .pc-list-row, .pc-alert-row, .pc-slot { padding: 12px 0; border-top: 1px solid #161B22; }
        .pc-run-row:first-of-type, .pc-list-row:first-of-type, .pc-alert-row:first-of-type, .pc-slot:first-of-type { border-top: 0; padding-top: 0; }
        .pc-overview-run { padding: 9px 8px; border-radius: 9px; background: #10151B; border: 1px solid #1B2129; }
        .pc-overview-account { width: 120px; flex: 0 0 auto; color: #9298A2; }
        .pc-overview-timer { color: #F4F6F0; }
        .pc-dot { width: 10px; height: 10px; border-radius: 50%; flex: 0 0 auto; }
        .pc-dot.ok { background: #BEF34A; }
        .pc-dot.warn { background: #FFB23E; }
        .pc-dot.err { background: #FF5E5E; }
        .pc-run-main, .pc-list-main { min-width: 0; flex: 1 1 auto; }
        .pc-run-top, .pc-list-title, .pc-bank-title { font-weight: 600; font-size: 16px; }
        .pc-run-bottom, .pc-list-sub, .pc-bank-meta, .pc-attention-detail, .pc-note { color: #838B96; font-size: 13px; line-height: 1.45; }
        .pc-mono, .pc-bank-article, .pc-slot-day { font: 700 10px/1.2 var(--pc-font-mono), "JetBrains Mono", ui-monospace, monospace; letter-spacing: .12em; text-transform: uppercase; color: #C7CCC4; }
        .pc-attention { width: 100%; display: grid; gap: 10px; align-items: flex-start; padding: 14px; border-radius: 16px; text-align: left; background: #12161B; border-left: 3px solid #FFB23E; cursor: pointer; }
        .pc-attention.err { border-left-color: #FF5E5E; }
        .pc-attention-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
        .pc-attention-title { font-weight: 600; font-size: 14px; color: #F2F4EF; }
        .pc-attention-detail { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
        .pc-overview-alert-row { width: 100%; display: flex; align-items: flex-start; gap: 12px; padding: 12px; border-radius: 10px; border: 1px solid #20252D; background: #12161B; text-align: left; cursor: pointer; }
        .pc-overview-alert-row.warn { border-left: 3px solid #FFB23E; }
        .pc-overview-alert-row.err { border-left: 3px solid #FF5E5E; }
        .pc-overview-alert-icon { color: #FFB23E; display: inline-flex; margin-top: 1px; }
        .pc-overview-alert-row.err .pc-overview-alert-icon { color: #FF5E5E; }
        .pc-overview-alert-copy { min-width: 0; display: grid; gap: 3px; }
        .pc-overview-alert-meta { font: 500 10px/1.45 var(--pc-font-mono), "JetBrains Mono", ui-monospace, monospace; color: #838B96; letter-spacing: .03em; }
        .pc-health-bar { display: flex; overflow: hidden; height: 16px; background: #12161B; border-radius: 999px; }
        .pc-health-bar.compact { height: 12px; gap: 2px; margin-bottom: 10px; background: transparent; }
        .pc-health-segment { min-width: 12px; }
        .pc-legend-item { display: inline-flex; align-items: center; gap: 6px; padding: 8px 10px; border-radius: 999px; background: #12161B; border: 1px solid #20252D; }
        .pc-legend.compact { gap: 18px; flex-wrap: wrap; }
        .pc-legend-item.compact { padding: 0; background: transparent; border: none; color: #9298A2; }
        .pc-legend-dot { width: 10px; height: 10px; border-radius: 50%; }
        .pc-search { display: flex; align-items: center; gap: 8px; min-width: 340px; padding: 12px 14px; background: #12161B; border: 1px solid #20252D; border-radius: 14px; }
        .pc-search input, .pc-banner select, .pc-rita-input input { width: 100%; color: #EDEFEA; outline: none; }
        .pc-bank-filters { gap: 5px; }
        .pc-bank-filter-note { font: 700 10px/1.2 var(--pc-font-mono), "JetBrains Mono", ui-monospace, monospace; color: #6E757F; letter-spacing: .02em; }
        .pc-bank-view-toggle { gap: 3px; padding: 3px; background: #161B22; border: 1px solid #20252D; border-radius: 8px; }
        .pc-toolbar-spacer { flex: 1; }
        .pc-chip { display: inline-flex; align-items: center; gap: 6px; padding: 8px 10px; border-radius: 999px; background: #161B22; border: 1px solid #20252D; color: #C7CCC4; cursor: pointer; }
        .pc-chip.active { color: #0B0D10; background: #BEF34A; border-color: #BEF34A; }
        .pc-bank-layout.grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(176px, 1fr)); }
        .pc-bank-layout.list { display: grid; gap: 12px; grid-template-columns: 1fr; }
        .pc-bank-card, .pc-channel-card, .pc-metric-card { position: relative; cursor: pointer; }
        .pc-bank-card { min-height: 410px; border-radius: 16px; background: #0E1116; overflow: hidden; padding: 0; }
        .pc-bank-actions { display: grid; gap: 8px; }
        .pc-bank-poster { position: relative; min-height: 272px; padding: 11px; display: flex; flex-direction: column; justify-content: space-between; }
        .pc-bank-poster.teal { background: linear-gradient(180deg, rgba(52,123,132,.95) 0%, rgba(38,89,96,.96) 100%); }
        .pc-bank-poster.olive { background: linear-gradient(180deg, rgba(101,131,42,.92) 0%, rgba(76,100,31,.96) 100%); }
        .pc-bank-poster.amber { background: linear-gradient(180deg, rgba(140,103,45,.94) 0%, rgba(102,74,32,.96) 100%); }
        .pc-bank-poster-top, .pc-bank-poster-bottom { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .pc-bank-score, .pc-bank-mini-state { display: inline-flex; align-items: center; justify-content: center; padding: 5px 9px; border-radius: 8px; font: 700 10px/1 var(--pc-font-mono), "JetBrains Mono", ui-monospace, monospace; letter-spacing: .04em; text-transform: uppercase; }
        .pc-bank-score.ok { background: #BEF34A; color: #0B0D10; }
        .pc-bank-score.warn { background: #FFB23E; color: #0B0D10; }
        .pc-bank-mini-state.ok { background: rgba(190,243,74,.16); color: #BEF34A; border: 1px solid rgba(190,243,74,.3); }
        .pc-bank-mini-state.warn { background: rgba(255,178,62,.12); color: #FFB23E; border: 1px solid rgba(255,178,62,.3); }
        .pc-bank-mini-state.err { background: rgba(255,94,94,.12); color: #FF5E5E; border: 1px solid rgba(255,94,94,.24); }
        .pc-bank-poster-bottom { justify-content: space-between; color: rgba(255,255,255,.9); }
        .pc-bank-poster-tag { display: inline-flex; align-items: center; padding: 5px 8px; border-radius: 999px; background: rgba(10,10,10,.24); border: 1px solid rgba(255,255,255,.12); font: 700 9px/1 var(--pc-font-mono), "JetBrains Mono", ui-monospace, monospace; letter-spacing: .08em; text-transform: uppercase; }
        .pc-bank-card-body { display: grid; gap: 8px; padding: 12px 14px 14px; }
        .pc-bank-meta-row, .pc-channel-row-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
        .pc-bank-chip { display: inline-flex; align-items: center; justify-content: center; padding: 4px 8px; border-radius: 6px; background: rgba(190,243,74,.1); border: 1px solid rgba(190,243,74,.22); color: #BEF34A; font: 700 9px/1 var(--pc-font-mono), "JetBrains Mono", ui-monospace, monospace; letter-spacing: .06em; text-transform: uppercase; }
        .pc-bank-warning { color: #FFB23E; font-size: 11px; line-height: 1.28; display: inline-flex; align-items: center; gap: 6px; max-width: 18ch; }
        .pc-pill { display: inline-flex; align-items: center; justify-content: center; padding: 6px 8px; border-radius: 999px; font: 700 10px/1 var(--pc-font-mono), "JetBrains Mono", ui-monospace, monospace; text-transform: uppercase; letter-spacing: .08em; border: 1px solid #20252D; background: #161B22; }
        .pc-pill.ok { color: #BEF34A; border-color: rgba(190,243,74,.22); background: rgba(190,243,74,.08); }
        .pc-pill.warn { color: #FFB23E; border-color: rgba(255,178,62,.22); background: rgba(255,178,62,.08); }
        .pc-pill.err { color: #FF5E5E; border-color: rgba(255,94,94,.2); background: rgba(255,94,94,.08); }
        .pc-channel-list { display: grid; gap: 10px; }
        .pc-channel-row { border-radius: 12px; padding: 14px 16px; background: #0E1116; }
        .pc-slot-card, .pc-alert-card { width: 100%; text-align: left; border-radius: 16px; background: #0E1116; border: 1px solid #20252D; padding: 14px 16px; cursor: pointer; }
        .pc-slot-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 14px; align-items: center; }
        .pc-slot-main { min-width: 0; display: grid; gap: 10px; }
        .pc-slot.locked { border-left: 3px solid #FFB23E; padding-left: 10px; }
        .pc-slot-button, .pc-row-button { width: 100%; text-align: left; cursor: pointer; }
        .pc-slot-meta, .pc-slot-side { display: flex; align-items: center; gap: 8px; }
        .pc-progress { margin-top: 8px; height: 6px; background: #12161B; border-radius: 999px; overflow: hidden; }
        .pc-progress span { display: block; height: 100%; background: linear-gradient(90deg, #BEF34A, #3FD8E6); border-radius: 999px; }
        .pc-metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 14px 0; }
        .pc-metric-grid span { display: block; color: #838B96; font-size: 11px; }
        .pc-metric-grid strong { display: block; margin-top: 3px; font-size: 18px; }
        .pc-curve { display: flex; align-items: end; gap: 4px; height: 46px; }
        .pc-curve-bar { width: 8px; border-radius: 999px; background: linear-gradient(180deg, #BEF34A, rgba(190,243,74,.18)); }
        .pc-empty { display: grid; place-items: center; gap: 10px; min-height: 260px; text-align: center; color: #C7CCC4; }
        .pc-boot-shell { align-items: start; }
        .pc-boot-shell .pc-card { box-shadow: inset 0 0 0 1px rgba(255,255,255,.02); }
        .pc-boot-card { background: linear-gradient(180deg, rgba(190,243,74,.08), rgba(14,17,22,1) 56%); min-height: 100%; padding: 20px; }
        .pc-boot-panel { background: #10151B; border-color: #262F3A; padding: 20px; }
        .pc-boot-copy { display: grid; gap: 16px; }
        .pc-boot-copy p { max-width: 56ch; color: #D7DBD3; font-size: 18px; line-height: 1.42; }
        .pc-boot-stats { display: grid; grid-template-columns: 1fr; gap: 12px; }
        .pc-boot-stat { display: grid; gap: 6px; padding: 14px; border-radius: 14px; border: 1px solid #26303A; background: rgba(12,16,21,.88); }
        .pc-boot-stat .pc-label, .pc-boot-stat strong, .pc-boot-stat span:last-child { display: block; }
        .pc-boot-stat strong { font: 600 17px/1.2 var(--pc-font-sans), "Space Grotesk", Inter, sans-serif; color: #F3F5F0; }
        .pc-boot-stat span:last-child { color: #97A0AC; font-size: 12px; line-height: 1.45; }
        .pc-boot-grid { align-items: stretch; }
        .pc-mini-card { padding: 14px; min-height: 100%; }
        .pc-checklist { display: grid; gap: 8px; margin-top: 12px; }
        .pc-boot-info-list { display: grid; gap: 10px; margin-bottom: 14px; }
        .pc-boot-info-row { display: grid; gap: 6px; padding: 10px 12px; border-radius: 12px; background: #0C1015; border: 1px solid #202A34; }
        .pc-boot-info-row strong { font-size: 14px; color: #F3F5F0; font-weight: 600; }
        .pc-boot-channel-metrics { display: grid; grid-template-columns: 1fr; gap: 10px; margin-top: 14px; }
        .pc-boot-channel-metrics div { padding: 10px 12px; border-radius: 12px; background: #0C1015; border: 1px solid #202A34; }
        .pc-boot-channel-metrics span { display: block; color: #97A0AC; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
        .pc-boot-channel-metrics strong { display: block; margin-top: 4px; font-size: 20px; color: #F3F5F0; }
        .pc-boot-panel .pc-note { line-height: 1.45; }
        .pc-boot-copy .pc-action-row { gap: 12px; }
        .pc-primary { display: inline-flex; align-items: center; gap: 6px; padding: 12px 16px; border-radius: 14px; background: #BEF34A; color: #0B0D10; font-weight: 800; cursor: pointer; }
        .pc-primary.ghost { background: #161B22; color: #EDEFEA; border: 1px solid #20252D; }
        .pc-evidence-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 16px; }
        .pc-evidence-card { padding: 12px 14px; border-radius: 14px; background: #12161B; border: 1px solid #20252D; display: grid; gap: 6px; }
        .pc-evidence-card strong { font: 700 24px/.95 var(--pc-font-sans), "Space Grotesk", Inter, sans-serif; color: #F4F6F0; letter-spacing: -.03em; }
        .pc-empty-state { display: grid; gap: 8px; padding: 4px 0 2px; }
        .pc-empty-title { font: 700 26px/1.02 var(--pc-font-sans), "Space Grotesk", Inter, sans-serif; color: #F4F6F0; letter-spacing: -.03em; }
        .pc-empty-state.warn .pc-empty-title { color: #FFEDC5; }
        .pc-empty-hint { margin-top: 12px; padding: 12px 14px; border-radius: 14px; background: #12161B; border: 1px solid #20252D; }
        .pc-link { color: #BEF34A; cursor: pointer; }
        .pc-list-side { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
        .pc-summary-band { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
        .pc-summary-band-bank { margin-bottom: 0; }
        .pc-summary-stat { padding: 12px 14px; border-radius: 14px; background: #12161B; border: 1px solid #20252D; display: grid; gap: 6px; }
        .pc-summary-stat strong { font: 700 24px/.95 var(--pc-font-sans), "Space Grotesk", Inter, sans-serif; color: #F4F6F0; letter-spacing: -.03em; }
        .pc-run-list, .pc-metric-list { display: grid; gap: 10px; }
        .pc-run-card, .pc-metric-row { width: 100%; text-align: left; border-radius: 16px; background: #0E1116; border: 1px solid #20252D; padding: 14px 16px; cursor: pointer; }
        .pc-run-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 14px; align-items: center; }
        .pc-run-card-main, .pc-metric-main { min-width: 0; display: grid; gap: 10px; }
        .pc-run-card-top { display: flex; align-items: center; gap: 10px; min-width: 0; flex-wrap: wrap; }
        .pc-run-card-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; color: #838B96; font-size: 13px; }
        .pc-run-card-meta span { display: inline-flex; align-items: center; gap: 8px; }
        .pc-run-card-meta span::after { content: ""; width: 3px; height: 3px; border-radius: 50%; background: #38404B; }
        .pc-run-card-meta span:last-child::after { display: none; }
        .pc-run-card-side, .pc-metric-side { display: grid; gap: 10px; justify-items: end; align-content: center; }
        .pc-alert-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 14px; align-items: center; }
        .pc-alert-card.warn { border-left: 3px solid #FFB23E; padding-left: 10px; }
        .pc-alert-card.err { border-left: 3px solid #FF5E5E; padding-left: 10px; }
        .selected { border-color: rgba(190,243,74,.38) !important; box-shadow: inset 0 0 0 1px rgba(190,243,74,.18); }
        .pc-inspector { position: sticky; top: 20px; }
        .pc-inspector-value { color: #F1F3EF; line-height: 1.4; }
        .pc-group-block + .pc-group-block { margin-top: 18px; }
        .pc-group-title { margin: 0 0 10px; font: 700 10px/1 var(--pc-font-mono), "JetBrains Mono", ui-monospace, monospace; letter-spacing: .12em; text-transform: uppercase; color: #9298A2; }
        .pc-fleet-table { display: grid; gap: 8px; }
        .pc-fleet-head, .pc-fleet-row { display: grid; grid-template-columns: minmax(156px, 1.3fr) .6fr .9fr .9fr 1fr .75fr .7fr .55fr .4fr; gap: 12px; align-items: center; }
        .pc-fleet-head { padding: 0 12px 6px; font: 700 9px/1 var(--pc-font-mono), "JetBrains Mono", ui-monospace, monospace; letter-spacing: .12em; text-transform: uppercase; color: #6E757F; }
        .pc-fleet-row { padding: 12px; border-radius: 14px; background: #0E1116; border: 1px solid #20252D; }
        .pc-fleet-ident, .pc-fleet-proxy, .pc-fleet-limit, .pc-fleet-warmup { display: grid; gap: 4px; min-width: 0; }
        .pc-fleet-ident strong { font-size: 13px; color: #F2F4EF; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pc-fleet-stream { color: #838B96; }
        .pc-fleet-health { display: flex; align-items: center; gap: 7px; color: #EDEFEA; font-size: 12px; }
        .pc-fleet-dim { color: #838B96; }
        .pc-fleet-bar { height: 3px; border-radius: 999px; overflow: hidden; background: #20252D; }
        .pc-fleet-bar span { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, #BEF34A, #3FD8E6); }
        .pc-fleet-session { display: flex; justify-content: center; }
        .pc-fleet-session-dot { width: 12px; height: 12px; border-radius: 999px; background: #3A424D; border: 1px solid #4A5360; }
        .pc-fleet-session-dot.ok { background: #BEF34A; border-color: rgba(190,243,74,.4); }
        .pc-fleet-session-dot.err { background: #FF5E5E; border-color: rgba(255,94,94,.34); }
        .pc-stack { display: grid; gap: 10px; }
        .pc-improvement-box { margin-top: 12px; padding: 12px; border-radius: 12px; background: #12161B; border: 1px solid #20252D; display: grid; gap: 8px; }
        .pc-learning-row { display: grid; gap: 4px; padding-top: 10px; border-top: 1px solid #1B2129; }
        .pc-learning-row:first-of-type { border-top: 0; padding-top: 0; }
        .pc-state-line { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .pc-metric-strip { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 10px; }
        .pc-metric-strip-item { display: grid; gap: 5px; align-content: start; padding: 12px 10px; border-radius: 12px; background: #12161B; border: 1px solid #20252D; }
        .pc-metric-strip-item strong { font: 700 20px/.95 var(--pc-font-sans), "Space Grotesk", Inter, sans-serif; color: #F4F6F0; }
        .pc-metric-strip-item span { color: #838B96; font-size: 11px; }
        .pc-metric-board { border: 1px solid #20252D; border-radius: 12px; overflow: hidden; }
        .pc-metric-head { display: grid; grid-template-columns: minmax(190px, 1.2fr) minmax(180px, 1fr) .6fr .6fr .6fr .75fr .85fr; gap: 14px; padding: 12px 14px; background: #10151B; font: 700 9px/1 var(--pc-font-mono), "JetBrains Mono", ui-monospace, monospace; letter-spacing: .12em; text-transform: uppercase; color: #6E757F; }
        .pc-metric-row { display: block; }
        .pc-metric-table { display: grid; grid-template-columns: minmax(190px, 1.2fr) minmax(180px, 1fr) .6fr .6fr .6fr .75fr .85fr; gap: 14px; align-items: center; }
        .pc-metric-post { display: grid; gap: 6px; }
        .pc-metric-post-head { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .pc-metric-post-copy { display: grid; gap: 4px; min-width: 0; }
        .pc-metric-thumb { width: 22px; height: 30px; border-radius: 4px; border: 1px solid rgba(255,255,255,.06); background: linear-gradient(180deg, #2E4A54 0%, #172026 100%); flex: 0 0 auto; }
        .pc-metric-thumb.teal { background: linear-gradient(180deg, #387B84 0%, #203238 100%); }
        .pc-metric-thumb.olive { background: linear-gradient(180deg, #6A8730 0%, #29351A 100%); }
        .pc-metric-thumb.amber { background: linear-gradient(180deg, #8C672D 0%, #392A16 100%); }
        .pc-metric-thumb.rose { background: linear-gradient(180deg, #84505F 0%, #2C1B22 100%); }
        .pc-metric-views { display: grid; gap: 8px; }
        .pc-metric-views strong { font-size: 26px; color: #F4F6F0; line-height: .95; }
        .pc-curve-inline { height: 20px; align-items: center; }
        .pc-curve-inline .pc-curve-bar { width: 9px; }
        .pc-curve-tall { height: 110px; gap: 7px; margin: 16px 0 12px; }
        .pc-curve-tall .pc-curve-bar { width: 14px; }
        .pc-metric-cell { color: #EDEFEA; font-size: 15px; font-weight: 500; }
        .pc-metric-status-cell { display: flex; justify-content: flex-end; }
        .pc-metric-aside { display: grid; gap: 16px; align-content: start; }
        .pc-metric-aside-top { display: flex; align-items: center; gap: 9px; }
        .pc-metric-curve-box { padding: 14px; border-radius: 12px; background: #12161B; border: 1px solid #20252D; }
        .pc-metric-curve-value { font: 700 22px/.95 var(--pc-font-sans), "Space Grotesk", Inter, sans-serif; color: #BEF34A; }
        .pc-poll-banner { display: flex; align-items: center; gap: 9px; background: #12161B; border: 1px solid #20252D; border-radius: 10px; padding: 10px 12px; font-size: 12px; color: #C7CCC4; }
        .pc-metric-winner-box { background: #172012; border: 1px solid rgba(190,243,74,.3); border-radius: 11px; padding: 13px 15px; display: grid; gap: 8px; }
        .pc-action-col { display: grid; gap: 8px; margin-top: auto; }
        .pc-metric-grid.compact { margin: 0; }
        .pc-metric-grid.compact strong { font-size: 16px; }
        .pc-note-clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; }
        .pc-modal { position: fixed; inset: 50% auto auto 50%; transform: translate(-50%, -50%); width: min(720px, 92vw); z-index: 74; background: #0E1116; border: 1px solid #262C35; border-radius: 14px; padding: 18px; box-shadow: 0 24px 70px rgba(0,0,0,.6); }
        .pc-wizard-grid { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-bottom: 14px; }
        .pc-form-field { display: grid; gap: 8px; }
        .pc-form-span-2 { grid-column: span 2; }
        .pc-form-field input, .pc-form-field textarea, .pc-form-field select { width: 100%; padding: 12px 14px; border-radius: 10px; background: #12161B; border: 1px solid #20252D; outline: none; resize: vertical; }
        .pc-publish-result { margin-top: 14px; padding: 12px; border-radius: 12px; background: #12161B; border: 1px solid #20252D; max-height: 220px; overflow: auto; }
        .pc-publish-result .pc-note { white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
        .pc-step { padding: 14px; border-radius: 12px; background: #12161B; border: 1px solid #20252D; }
        .pc-step-n { display: inline-flex; width: 24px; height: 24px; border-radius: 50%; align-items: center; justify-content: center; margin-bottom: 10px; background: rgba(190,243,74,.12); color: #BEF34A; font: 700 11px/1 var(--pc-font-mono), "JetBrains Mono", ui-monospace, monospace; }
        .pc-rita-pill { position: fixed; left: 14px; bottom: 104px; z-index: 71; display: inline-flex; align-items: center; gap: 10px; padding: 8px 12px 8px 8px; border-radius: 999px; background: #0E1116; border: 1px solid #262C35; box-shadow: 0 8px 24px rgba(0,0,0,.45); color: #EDEFEA; cursor: pointer; opacity: .92; }
        .pc-rita-pill:hover { border-color: #BEF34A; }
        .pc-rita-avatar { display: inline-flex; width: 30px; height: 30px; align-items: center; justify-content: center; border-radius: 50%; background: linear-gradient(135deg,#BEF34A,#8FD41F); color: #0B0D10; font-weight: 800; }
        .pc-rita-avatar.big { width: 36px; height: 36px; }
        .pc-rita-pill span strong { display: block; font-size: 13px; }
        .pc-rita-pill span em { display: block; font-style: normal; color: #838B96; font-size: 11px; }
        .pc-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 72; }
        .pc-rita { position: fixed; left: 0; top: 0; bottom: 0; width: 390px; max-width: 92vw; background: #0E1116; border-right: 1px solid #262C35; box-shadow: 24px 0 60px rgba(0,0,0,.6); z-index: 73; display: flex; flex-direction: column; animation: slideInLeft .26s cubic-bezier(.16,1,.3,1); }
        .pc-rita-head, .pc-rita-input { padding: 14px; border-bottom: 1px solid #161B22; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .pc-rita-brand { display: flex; align-items: center; gap: 10px; }
        .pc-rita-brand strong { display: block; }
        .pc-rita-brand span { display: block; color: #838B96; font-size: 12px; }
        .pc-rita-body { flex: 1 1 auto; overflow: auto; padding: 14px; display: grid; gap: 10px; }
        .pc-bubble { max-width: 88%; padding: 12px; border: 1px solid #20252D; background: #161B22; border-radius: 4px 12px 12px 12px; }
        .pc-bubble.user { margin-left: auto; background: rgba(190,243,74,.14); border-color: rgba(190,243,74,.32); border-radius: 12px 12px 4px 12px; }
        .pc-bubble p { margin: 0 0 8px; }
        .pc-rita-input { border-top: 1px solid #161B22; border-bottom: 0; }
        .pc-rita-input input { padding: 12px 14px; border-radius: 10px; background: #12161B; border: 1px solid #20252D; }
        .pc-rita-input button { width: 40px; height: 40px; border-radius: 10px; background: #BEF34A; color: #0B0D10; cursor: pointer; }
        .pc-toasts { position: fixed; right: 18px; bottom: 18px; z-index: 75; display: grid; gap: 10px; }
        .pc-toast { display: flex; align-items: center; gap: 8px; min-width: 220px; padding: 11px 12px; border-radius: 12px; border: 1px solid #20252D; background: #12161B; box-shadow: 0 18px 50px rgba(0,0,0,.55); }
        .pc-toast.ok { color: #BEF34A; }
        .pc-toast.err { color: #FF5E5E; }
        .pc-toast.info { color: #3FD8E6; }
        .spin { animation: spin .9s linear infinite; }
        @keyframes slideInLeft { from { transform: translateX(-24px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }
        @media (max-width: 1180px) {
          .pc-shell { grid-template-columns: 1fr; }
          .pc-summary-band, .pc-metric-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .pc-run-card, .pc-metric-row, .pc-slot-card, .pc-alert-card { grid-template-columns: 1fr; }
          .pc-run-card-side, .pc-metric-side { justify-items: start; }
          .pc-fleet-head, .pc-fleet-row { grid-template-columns: 1fr; }
          .pc-fleet-head { display: none; }
          .pc-fleet-session { justify-content: flex-start; }
          .pc-metric-table { grid-template-columns: 1fr; }
          .pc-metric-status-cell { justify-content: flex-start; }
          .pc-rail { display: none; }
          .pc-tab-grid, .pc-kpis, .pc-grid-3, .pc-grid-2, .pc-grid-shell, .pc-bank-layout.grid, .pc-wizard-grid, .pc-boot-stats, .pc-boot-channel-metrics, .pc-overview-main { grid-template-columns: 1fr; }
          .pc-evidence-grid { grid-template-columns: 1fr; }
          .pc-span-2, .pc-span-3, .pc-span-main { grid-column: span 1; }
          .pc-inspector { position: static; }
          .pc-header { min-height: auto; padding: 14px; align-items: flex-start; }
          .pc-title-block { min-width: 0; }
          .pc-warning-strip { margin: 14px 14px 0; }
          .pc-content { min-width: 0; padding: 14px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .pc-skeleton-card, .spin, .pc-rita { animation: none !important; }
        }
      `}</style>
    </div>
  );
}

function EmptyInline({ text }: { text: string }) {
  return <div className="pc-note">{text}</div>;
}

function EmptyStatePanel({
  eyebrow,
  title,
  text,
  tone = "neutral",
}: {
  eyebrow: string;
  title: string;
  text: string;
  tone?: "neutral" | "warn";
}) {
  return (
    <div className={`pc-empty-state ${tone}`}>
      <div className="pc-label">{eyebrow}</div>
      <div className="pc-empty-title">{title}</div>
      <div className="pc-note">{text}</div>
    </div>
  );
}

function InspectorLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="pc-label" style={{ marginBottom: 4 }}>{label}</div>
      <div className="pc-inspector-value" style={{ marginBottom: 12 }}>{value}</div>
    </div>
  );
}

function WizardStep({ index, title, text }: { index: number; title: string; text: string }) {
  return (
    <div className="pc-step">
      <div className="pc-step-n">{index}</div>
      <div className="pc-list-title" style={{ marginBottom: 6 }}>{title}</div>
      <div className="pc-note">{text}</div>
    </div>
  );
}
