import { getChannelAdapter } from "./publishAdapters";
import { readDistributionTargetConfig } from "./distributionTargets";
import { learningHints } from "./learningHints";
import { loadM6OpsSnapshot } from "./m6Ops";
import { buildWorkerHeartbeatDiagnostics, loadWorkerDocs, loadWorkerSnapshot } from "./workerState";

type DbClient = {
  from: (table: string) => any;
};

type StreamKey = "all" | "product" | "manya";
type CockpitScreenKey = "overview" | "bank" | "calendar" | "fleet" | "runs" | "metrics" | "channels" | "alerts";
type WorkerState = "unknown" | "alive" | "stale" | "dead";

type JsonRecord = Record<string, unknown>;

type OverviewTile = {
  id: string;
  label: string;
  value: number;
  delta: number;
  targetScreen: string;
  spark: number[];
};

type LiveRunItem = {
  id: string;
  platform: string;
  account: string;
  article: string;
  stage: string;
  timerSec: number | null;
  status: string;
  attemptLabel: string | null;
};

type AttentionItem = {
  id: string;
  severity: "warn" | "err";
  title: string;
  detail: string;
  targetScreen: string;
};

type HealthBucket = {
  key: string;
  label: string;
  count: number;
  color: string;
};

type BankItem = {
  id: string;
  recipeId: number;
  article: string;
  title: string;
  niche: string;
  format: string;
  otkScore: number | null;
  status: "ready" | "scheduled" | "held" | "queued";
  stream: Exclude<StreamKey, "all">;
  published: string[];
  needsUniqueVariant: boolean;
  targetPlatform: string;
  outputUrl: string | null;
  updatedAt: string | null;
};

type CalendarSlot = {
  id: string;
  day: string;
  group: string;
  platform: string;
  article: string;
  state: "empty" | "scheduled" | "publishing" | "published" | "locked" | "failed";
  time: string | null;
  complianceLocked: boolean;
};

type FleetAccount = {
  id: string;
  handle: string;
  platform: string;
  stream: Exclude<StreamKey, "all">;
  health: string;
  warmup: string;
  proxyKind: string;
  proxySid: string | null;
  cap: number | null;
  posts: number | null;
  lastPost: string | null;
  box: string;
  session: boolean | null;
  profileId: string | null;
  banEvidence: string | null;
  complianceStatus: string | null;
};

type RunItem = {
  id: string;
  recipeId: number;
  publicationId: string | null;
  platform: string;
  account: string;
  article: string;
  stage: string;
  timerSec: number | null;
  progress: number | null;
  reason: string | null;
  attemptLabel: string | null;
  publishedUrl: string | null;
  externalId: string | null;
  box: string;
  status: string;
};

type MetricItem = {
  id: string;
  recipeId: number;
  publicationId: string | null;
  externalPostId: string | null;
  platform: string;
  article: string;
  views: number;
  watch: number | null;
  saves: number | null;
  orders: number | null;
  revenue: number | null;
  status: "winner" | "fresh" | "salvageable" | "polling-scheduled" | "source-banned" | "stale";
  stream: Exclude<StreamKey, "all">;
  curve: number[];
  postedAt: string | null;
};

type ChannelCard = {
  id: string;
  name: string;
  platform: string;
  transport: "api" | "browser" | "unconfirmed";
  runsOn: string;
  status: "api-configured" | "token-missing" | "browser-session-ok" | "session-dead" | "compliance-block" | "transport-unconfirmed";
  accounts: number;
  alerts: number;
  publishEnabled: boolean;
  metricsEnabled: boolean;
};

type AlertItem = {
  id: string;
  kind: string;
  severity: "warn" | "err";
  title: string;
  account: string;
  channel: string;
  time: string | null;
  evidence: string;
  action: string;
  stream: StreamKey;
};

type CockpitMode = "boot" | "partial" | "full";

type CoverageMap = {
  bank: boolean;
  calendar: boolean;
  fleet: boolean;
  runs: boolean;
  metrics: boolean;
  channels: boolean;
  alerts: boolean;
};

type CockpitPayload = {
  ok: boolean;
  configured: boolean;
  mode: CockpitMode;
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
  coverage: CoverageMap;
  worker: {
    online: boolean;
    state: WorkerState;
    source: string;
    lastSeen: string | null;
    currentTask: string | null;
    branch: string | null;
    diagnostics: ReturnType<typeof buildWorkerHeartbeatDiagnostics> | null;
  };
  overview: {
    tiles: OverviewTile[];
    liveRuns: LiveRunItem[];
    attention: AttentionItem[];
    health: HealthBucket[];
  };
  improvementLoop: {
    ready: boolean;
    niche: string | null;
    winners7d: number;
    winnerPresets: number;
    learningHints: string;
    nextStep: string;
  };
  bank: BankItem[];
  calendar: CalendarSlot[];
  fleet: FleetAccount[];
  runs: RunItem[];
  metrics: MetricItem[];
  channels: ChannelCard[];
  alerts: AlertItem[];
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown, max = 200): string {
  const cleaned = String(value ?? "").trim();
  return cleaned ? cleaned.slice(0, max) : "";
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function count(value: unknown): number | null {
  const parsed = num(value);
  return parsed == null ? null : Math.max(0, Math.floor(parsed));
}

function pct(value: unknown): number | null {
  const parsed = num(value);
  if (parsed == null) return null;
  return parsed > 1 ? Math.max(0, Math.min(1, parsed / 100)) : Math.max(0, Math.min(1, parsed));
}

function sampleSpark(base: number, spread = 4): number[] {
  return Array.from({ length: 7 }, (_, index) => Math.max(0, base - spread + ((index * 3) % (spread * 2 + 1))));
}

function safeError(error: unknown): string {
  return String((error as { message?: unknown } | null)?.message || error || "unknown").slice(0, 180);
}

function isNonBlockingWarning(warning: string): boolean {
  const text = warning.toLowerCase();
  return (
    text.includes("post_metrics: using legacy read fallback")
    || text.includes("market_read_layer: no post_metrics rows visible")
    || (text.includes("factory_ugc_jobs") && text.includes("could not find the table"))
  );
}

async function safeSelect(db: DbClient, table: string, select: string, opts: {
  order?: string;
  ascending?: boolean;
  limit?: number;
} = {}) {
  try {
    let query = db.from(table).select(select);
    if (opts.order) query = query.order(opts.order, { ascending: opts.ascending ?? false });
    if (opts.limit) query = query.limit(opts.limit);
    const res = await query;
    if (res?.error) return { rows: [] as JsonRecord[], warning: `${table}: ${safeError(res.error)}` };
    return { rows: ((res?.data as JsonRecord[] | null) || []), warning: null as string | null };
  } catch (error) {
    return { rows: [] as JsonRecord[], warning: `${table}: ${safeError(error)}` };
  }
}

async function safeSelectOneOf(db: DbClient, table: string, selects: string[], opts: {
  order?: string;
  ascending?: boolean;
  limit?: number;
} = {}) {
  const attempts: string[] = [];
  for (let index = 0; index < selects.length; index += 1) {
    const candidate = selects[index];
    const res = await safeSelect(db, table, candidate, opts);
    if (!res.warning) {
      return {
        rows: res.rows,
        warning: attempts.length ? `${table}: using legacy read fallback` : null as string | null,
      };
    }
    attempts.push(res.warning);
  }
  return { rows: [] as JsonRecord[], warning: attempts[attempts.length - 1] || `${table}: read failed` };
}

function streamForPlatform(platform: unknown, accountRef = ""): Exclude<StreamKey, "all"> {
  const value = text(platform, 80).toLowerCase();
  const account = accountRef.toLowerCase();
  if (account.includes("manya")) return "manya";
  if (value === "pinterest" || value === "telegram" || value === "vk" || value === "vk_clips" || value === "wibes" || value === "ok" || account.includes("norvia") || account.includes("product")) {
    return "product";
  }
  return "manya";
}

function platformLabel(platform: string): string {
  if (platform === "vk_clips") return "VK Clips";
  if (platform === "vk") return "VK";
  if (platform === "ok") return "OK";
  if (platform === "wibes") return "Wibes";
  if (platform === "youtube") return "YouTube";
  if (platform === "instagram") return "Instagram";
  if (platform === "pinterest") return "Pinterest";
  if (platform === "telegram") return "Telegram";
  if (platform === "threads") return "Threads";
  if (platform === "tiktok") return "TikTok";
  return platform || "Unknown";
}

function telegramApiConfigured() {
  return !!(text(process.env.FACTORY_TG_BOT_TOKEN, 4000) && text(process.env.FACTORY_TG_CHAT_ID, 4000));
}

function healthLabel(config: ReturnType<typeof readDistributionTargetConfig>): string {
  if (config.health_state === "banned") return "banned";
  if (config.health_state === "captcha") return "captcha";
  if (config.session_valid === false) return "needs-login";
  if (config.health_state === "flagged") return "proxy-flip";
  if (config.warmup_stage === "warming" || config.warmup_stage === "cold") return "warming";
  if (config.warmup_stage === "cooling") return "cooling";
  return "active";
}

function runStageFromStatus(status: string, metadata: JsonRecord): string {
  const adapterFailure = text(metadata.adapter_failure, 120).toLowerCase();
  if (status === "failed" && adapterFailure === "banned") return "failed";
  if (status === "published" && metadata.pending_moderation === true) return "awaiting-moderation";
  if (status === "publishing") return "uploading";
  if (status === "scheduled") return "claiming";
  return status || "draft";
}

function timerSecFromTime(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round((Date.now() - ms) / 1000));
}

function eventTimeMs(value: string | null): number {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function metricStatus(row: JsonRecord): MetricItem["status"] {
  const views = count(row.views) || 0;
  const orders = count(row.marketplace_orders);
  const watch = pct(row.watch_rate ?? row.completion_rate);
  const raw = asRecord(row.raw_metrics);
  if (String(raw.health_state || "").toLowerCase() === "banned") return "source-banned";
  if (views >= 5000) return "winner";
  if (views >= 2000 || (orders || 0) > 0) return "fresh";
  if ((watch || 0) >= 0.35) return "salvageable";
  if (timerSecFromTime(text(row.posted_at || row.pulled_at || "", 80)) != null && (timerSecFromTime(text(row.posted_at || row.pulled_at || "", 80)) || 0) < 6 * 3600) {
    return "polling-scheduled";
  }
  return "stale";
}

function uniqWarnings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter(Boolean) as string[]));
}

function systemWarningTitle(warning: string) {
  const lower = warning.toLowerCase();
  if (lower.includes("post_metrics") && lower.includes("legacy read fallback")) return "Рынок читает legacy path";
  if (lower.includes("post_metrics")) return "Рынок требует внимания";
  if (lower.includes("factory_distribution_targets")) return "Флот читает частично";
  if (lower.includes("factory_publications")) return "Публикации читаются частично";
  return "Частичный read-only деград";
}

function systemWarningTargetScreen(warning: string): CockpitScreenKey {
  const lower = warning.toLowerCase();
  if (lower.includes("post_metrics")) return "metrics";
  if (lower.includes("factory_distribution_targets")) return "fleet";
  if (lower.includes("factory_publications")) return "runs";
  return "channels";
}

function applyStream<T extends { stream?: StreamKey }>(rows: T[], stream: StreamKey): T[] {
  if (stream === "all") return rows;
  return rows.filter((row) => (row.stream || "all") === stream);
}

async function safeCount(db: DbClient, table: string, filters: Array<[string, unknown]>) {
  try {
    let q = db.from(table).select("id", { count: "exact", head: true });
    for (const [key, value] of filters) q = q.eq(key, value);
    const res = await q;
    if (res?.error) return { count: 0, warning: `${table}: ${safeError(res.error)}` };
    return { count: Number(res?.count) || 0, warning: null as string | null };
  } catch (error) {
    return { count: 0, warning: `${table}: ${safeError(error)}` };
  }
}

export async function loadPublishingCockpit(db: DbClient | null | undefined, stream: StreamKey = "all"): Promise<CockpitPayload> {
  const generatedAt = new Date().toISOString();
  if (!db) {
    return {
      ok: true,
      configured: false,
      mode: "boot",
      stream,
      generatedAt,
      warnings: ["Supabase is not configured"],
      readEvidence: {
        recipesVisible: 0,
        generatedVideosVisible: 0,
        publicationsVisible: 0,
        metricsVisible: 0,
        targetsVisible: 0,
      },
      coverage: {
        bank: false,
        calendar: false,
        fleet: false,
        runs: false,
        metrics: false,
        channels: false,
        alerts: false,
      },
      worker: { online: false, state: "unknown", source: "unconfigured", lastSeen: null, currentTask: null, branch: null, diagnostics: null },
      overview: { tiles: [], liveRuns: [], attention: [], health: [] },
      improvementLoop: { ready: false, niche: null, winners7d: 0, winnerPresets: 0, learningHints: "", nextStep: "Нужен Supabase, чтобы собрать рынок и learning loop." },
      bank: [],
      calendar: [],
      fleet: [],
      runs: [],
      metrics: [],
      channels: [],
      alerts: [],
    };
  }

  const warnings: string[] = [];
  const [recipesRes, contentAssetsRes, pubsRes, targetsRes, metricsRes, workerDocs, m6Ops] = await Promise.all([
    safeSelect(db, "node_recipes", "id,article,niche,mode,status,run_plan,output_url,updated_at,created_at", { order: "updated_at", limit: 120 }),
    safeSelect(db, "content_assets", "id,name,kind,url,niche,article,analysis,created_at", { order: "created_at", limit: 160 }),
    safeSelect(db, "factory_publications", "id,recipe_id,target_id,platform,mode,status,source_url,published_url,external_post_id,error,scheduled_at,published_at,created_at,updated_at,metadata", { order: "updated_at", limit: 200 }),
    safeSelect(db, "factory_distribution_targets", "id,platform,account_ref,mode,config,created_at,updated_at", { order: "updated_at", limit: 120 }),
    safeSelectOneOf(db, "post_metrics", [
      "recipe_id,publication_id,external_post_id,platform,posted_at,views,watch_rate,completion_rate,ctr_card,saves,engagement_count,marketplace_orders,revenue,pulled_at,source,raw_metrics",
      "recipe_id,publication_id,external_post_id,platform,posted_at,views,watch_rate,ctr_card,saves,engagement_count,marketplace_orders,revenue,pulled_at,source,raw_metrics",
      "recipe_id,publication_id,external_post_id,platform,posted_at,views,watch_rate,marketplace_orders,revenue,saves,raw_metrics",
      "recipe_id,publication_id,external_post_id,platform,posted_at,views,watch_rate,hook_rate,hold_rate,completion_rate,ctr_card,saves,engagement_count,marketplace_orders,revenue,pulled_at,source,raw_metrics",
      "recipe_id,external_post_id,platform,posted_at,views,watch_rate,ctr_card,saves,engagement_count,marketplace_orders,revenue,pulled_at,source,raw_metrics",
      "recipe_id,external_post_id,platform,posted_at,views,watch_rate,marketplace_orders,revenue,saves,raw_metrics",
      "recipe_id,external_post_id,platform,posted_at,views,watch_rate,hook_rate,hold_rate,completion_rate,ctr_card,saves,engagement_count,marketplace_orders,revenue,pulled_at,source,raw_metrics",
      "recipe_id,views,watch_rate,marketplace_orders,revenue,saves,posted_at",
      "recipe_id,views,watch_rate,ctr_card,saves,posted_at",
    ], { order: "posted_at", limit: 160 }),
    loadWorkerDocs(),
    loadM6OpsSnapshot(db),
  ]);
  warnings.push(...uniqWarnings([recipesRes.warning, contentAssetsRes.warning, pubsRes.warning, targetsRes.warning, metricsRes.warning]));

  const workerSnapshot = await loadWorkerSnapshot(db as any, workerDocs.queue);
  if (workerSnapshot.db_error) warnings.push("worker_state: " + workerSnapshot.db_error.slice(0, 160));

  const recipesById = new Map<number, JsonRecord>();
  for (const row of recipesRes.rows) recipesById.set(Number(row.id), row);

  const targetsById = new Map<string, { row: JsonRecord; config: ReturnType<typeof readDistributionTargetConfig>; stream: Exclude<StreamKey, "all"> }>();
  const targetsByPlatform = new Map<string, Array<{ row: JsonRecord; config: ReturnType<typeof readDistributionTargetConfig>; stream: Exclude<StreamKey, "all"> }>>();
  const fleetAll: FleetAccount[] = [];
  for (const row of targetsRes.rows) {
    const config = readDistributionTargetConfig(row.config);
    const targetStream = streamForPlatform(row.platform, text(row.account_ref, 120));
    const platformKey = text(row.platform, 80) || "unknown";
    const account: FleetAccount = {
      id: text(row.id, 120) || crypto.randomUUID(),
      handle: text(row.account_ref, 120) || "unnamed",
      platform: platformKey,
      stream: targetStream,
      health: healthLabel(config),
      warmup: config.warmup_stage || "unknown",
      proxyKind: config.proxy_kind || "n/a",
      proxySid: config.proxy_sid,
      cap: config.daily_cap,
      posts: config.posts_today,
      lastPost: config.last_post_at,
      box: config.worker_box_id || (getChannelAdapter(row.platform)?.transport === "api" ? "cloud" : "local"),
      session: config.session_valid,
      profileId: config.profile_id,
      banEvidence: config.ban_evidence,
      complianceStatus: config.compliance_status,
    };
    fleetAll.push(account);
    targetsById.set(account.id, { row, config, stream: targetStream });
    targetsByPlatform.set(platformKey, [...(targetsByPlatform.get(platformKey) || []), { row, config, stream: targetStream }]);
  }

  const publications = pubsRes.rows.map((row) => {
    const metadata = asRecord(row.metadata);
    const resolvedTargetId = text(row.target_id, 120) || text(metadata.target_id, 120);
    const recipe = recipesById.get(Number(row.recipe_id)) || {};
    const article = text(recipe.article, 80) || text(metadata.article, 80) || `recipe-${Number(row.recipe_id) || "?"}`;
    const platform = text(row.platform, 80) || "unknown";
    const platformTargets = targetsByPlatform.get(platform) || [];
    const fallbackPlatformTarget = platformTargets.length === 1 ? platformTargets[0] : undefined;
    const target = (resolvedTargetId ? targetsById.get(resolvedTargetId) : undefined) || fallbackPlatformTarget;
    const accountRef =
      text(target?.row.account_ref, 120)
      || text(metadata.target_account_ref, 120)
      || text(metadata.account_ref, 120)
      || "";
    const publicationStream = target?.stream || streamForPlatform(platform, accountRef);
    return {
      id: text(row.id, 120) || crypto.randomUUID(),
      recipeId: Number(row.recipe_id) || 0,
      targetId: resolvedTargetId,
      platform,
      mode: text(row.mode, 80) || "organic",
      status: text(row.status, 80) || "draft",
      sourceUrl: text(row.source_url, 1200),
      publishedUrl: text(row.published_url, 1200) || null,
      externalPostId: text(row.external_post_id, 240) || null,
      error: text(row.error, 240) || null,
      scheduledAt: text(row.scheduled_at, 80) || null,
      publishedAt: text(row.published_at, 80) || null,
      createdAt: text(row.created_at, 80) || null,
      updatedAt: text(row.updated_at, 80) || null,
      metadata,
      account: accountRef || platformLabel(platform),
      article,
      stream: publicationStream,
      box: target?.config.worker_box_id || (getChannelAdapter(platform)?.transport === "api" ? "cloud" : "local"),
      attemptLabel: metadata.attempt ? `${Math.max(1, Number(metadata.attempt) || 1)} / 3` : null,
      stage: runStageFromStatus(text(row.status, 80), metadata),
    };
  });

  const bankPublished = new Map<number, string[]>();
  for (const publication of publications) {
    if (publication.status === "published") {
      bankPublished.set(publication.recipeId, [...(bankPublished.get(publication.recipeId) || []), publication.platform]);
    }
  }

  const bankAll: BankItem[] = recipesRes.rows
    .map((row) => {
      const plan = asRecord(row.run_plan);
      const article = text(row.article, 80) || `recipe-${Number(row.id)}`;
      const targetPlatform = text(plan.target_platform, 80) || "pinterest";
      const bankStream = streamForPlatform(targetPlatform);
      const otk = asRecord(plan.otk || plan.bestOtk);
      const outputUrl = text(row.output_url, 1200);
      const status = text(row.status, 80);
      let bankStatus: BankItem["status"] = "held";
      if (outputUrl && (status === "otk_pass" || status === "done" || status === "running")) bankStatus = "ready";
      if (publications.some((publication) => publication.recipeId === Number(row.id) && publication.status === "scheduled")) bankStatus = "scheduled";
      if (publications.some((publication) => publication.recipeId === Number(row.id) && publication.status === "publishing")) bankStatus = "queued";
      return {
        id: `recipe-${Number(row.id)}`,
        recipeId: Number(row.id) || 0,
        article,
        title: text(plan.title, 140) || text(plan.hook, 140) || article,
        niche: text(row.niche, 80) || "general",
        format: text(plan.format, 80) || text(plan.target_platform, 80) || "video",
        otkScore: num(otk.score),
        status: bankStatus,
        stream: bankStream,
        published: bankPublished.get(Number(row.id)) || [],
        needsUniqueVariant: bankStream === "manya",
        targetPlatform,
        outputUrl,
        updatedAt: text(row.updated_at, 80) || null,
      };
    })
    .filter((item) => item.outputUrl);

  const bankFallback: BankItem[] = bankAll.length ? [] : contentAssetsRes.rows
    .filter((row) => text(row.kind, 20) === "video" && text(row.url, 1200))
    .map((row) => {
      const analysis = asRecord(row.analysis);
      const targetPlatform = text(analysis.target_platform, 80) || "pinterest";
      const article = text(row.article, 80) || `asset-${text(row.id, 80) || "?"}`;
      const recipeId = Number(analysis.recipe_id) || 0;
      return {
        id: `asset-${text(row.id, 80) || crypto.randomUUID()}`,
        recipeId,
        article,
        title: text(analysis.hook, 140) || text(row.name, 140) || article,
        niche: text(row.niche, 80) || "general",
        format: text(analysis.route, 80) || text(analysis.engine, 80) || text(row.kind, 40) || "video",
        otkScore: num(analysis.otk),
        status: "ready" as BankItem["status"],
        stream: streamForPlatform(targetPlatform),
        published: [],
        needsUniqueVariant: streamForPlatform(targetPlatform) === "manya",
        targetPlatform,
        outputUrl: text(row.url, 1200) || null,
        updatedAt: text(row.created_at, 80) || null,
      };
    });

  if (!bankAll.length && !bankFallback.length) {
    warnings.push("bank_read_layer: no visible recipes or generated video assets in clean pod");
  }
  const readEvidence = {
    recipesVisible: recipesRes.rows.length,
    generatedVideosVisible: contentAssetsRes.rows.filter((row) => text(row.kind, 20) === "video" && text(row.url, 1200)).length,
    publicationsVisible: pubsRes.rows.length,
    metricsVisible: metricsRes.rows.length,
    targetsVisible: targetsRes.rows.length,
  };

  const runsAll: RunItem[] = publications
    .filter((publication) => ["scheduled", "publishing", "published", "failed"].includes(publication.status))
    .slice(0, 60)
    .map((publication) => ({
      id: publication.id,
      recipeId: publication.recipeId,
      publicationId: publication.id,
      platform: publication.platform,
      account: publication.account,
      article: publication.article,
      stage: publication.stage,
      timerSec: timerSecFromTime(publication.updatedAt || publication.createdAt),
      progress: publication.status === "publishing" ? 0.55 : publication.status === "published" ? 1 : publication.status === "scheduled" ? 0.2 : 0.92,
      reason: publication.error || text(publication.metadata.adapter_failure, 120) || null,
      attemptLabel: publication.attemptLabel,
      publishedUrl: publication.publishedUrl,
      externalId: publication.externalPostId,
      box: publication.box,
      status: publication.status,
    }));

  const latestPublicationByRecipe = new Map<number, typeof publications[number]>();
  for (const publication of publications) {
    const current = latestPublicationByRecipe.get(publication.recipeId);
    const publicationTs = Math.max(eventTimeMs(publication.publishedAt), eventTimeMs(publication.updatedAt), eventTimeMs(publication.createdAt));
    const currentTs = current
      ? Math.max(eventTimeMs(current.publishedAt), eventTimeMs(current.updatedAt), eventTimeMs(current.createdAt))
      : -1;
    if (!current || publicationTs >= currentTs) latestPublicationByRecipe.set(publication.recipeId, publication);
  }

  const metricsSeed: MetricItem[] = metricsRes.rows
    .map((row, index) => {
      const recipe = recipesById.get(Number(row.recipe_id)) || {};
      const linkedPublication = text(row.publication_id, 120)
        ? publications.find((publication) => publication.id === text(row.publication_id, 120))
        : latestPublicationByRecipe.get(Number(row.recipe_id) || 0) || null;
      const publicationId = text(row.publication_id, 120) || linkedPublication?.id || null;
      const externalPostId = text(row.external_post_id, 240) || linkedPublication?.externalPostId || null;
      const platform = (text(row.platform, 80) || linkedPublication?.platform || "").toLowerCase();
      const metricStream = linkedPublication?.stream || streamForPlatform(platform, linkedPublication?.account || "");
      const views = count(row.views) || 0;
      const watch = pct(row.watch_rate ?? row.completion_rate);
      const saves = count(row.saves);
      const orders = count(row.marketplace_orders ?? row.orders);
      const revenue = num(row.revenue);
      return {
        id: `${publicationId || externalPostId || `${Number(row.recipe_id) || 0}:${platform || "unknown"}:${text(row.posted_at || row.pulled_at, 80) || index}`}`,
        recipeId: Number(row.recipe_id) || 0,
        publicationId,
        externalPostId,
        platform,
        article: text(recipe.article, 80) || `recipe-${Number(row.recipe_id) || "?"}`,
        views,
        watch,
        saves,
        orders,
        revenue,
        status: metricStatus(row),
        stream: metricStream,
        curve: sampleSpark(Math.max(views / 300, 3), 8),
        postedAt: text(row.posted_at || row.pulled_at, 80) || null,
      };
    })
    .filter((item) => item.views > 0);

  const dedupedMetrics = new Map<string, MetricItem>();
  for (const metric of metricsSeed) {
    const key = metric.publicationId || metric.externalPostId || `${metric.recipeId}:${metric.platform || "unknown"}`;
    const current = dedupedMetrics.get(key);
    if (!current || eventTimeMs(metric.postedAt) >= eventTimeMs(current.postedAt)) dedupedMetrics.set(key, metric);
  }
  const metricsAll = Array.from(dedupedMetrics.values())
    .sort((a, b) => eventTimeMs(b.postedAt) - eventTimeMs(a.postedAt));

  const channelSeed = new Map<string, ChannelCard>();
  for (const account of fleetAll) {
    const key = account.platform;
    const transport = getChannelAdapter(account.platform)?.transport || (account.profileId || account.proxySid ? "browser" : "unconfirmed");
    const adapter = getChannelAdapter(account.platform);
    const status: ChannelCard["status"] =
      account.complianceStatus === "blocked" || account.complianceStatus === "rejected"
        ? "compliance-block"
        : transport === "api"
          ? account.session === false
            ? "token-missing"
            : "api-configured"
          : transport === "browser"
            ? account.session === false
              ? "session-dead"
              : "browser-session-ok"
            : "transport-unconfirmed";
    const current = channelSeed.get(key) || {
      id: key,
      name: platformLabel(key),
      platform: key,
      transport,
      runsOn: transport === "api" ? "Vercel" : account.box,
      status,
      accounts: 0,
      alerts: 0,
      publishEnabled: adapter?.capabilities.publish ?? transport !== "unconfirmed",
      metricsEnabled: adapter?.capabilities.metrics ?? false,
    };
    current.accounts += 1;
    if (status !== "api-configured" && status !== "browser-session-ok") current.alerts += 1;
    channelSeed.set(key, current);
  }
  if (!channelSeed.has("pinterest")) {
    const adapter = getChannelAdapter("pinterest");
    channelSeed.set("pinterest", {
      id: "pinterest",
      name: "Pinterest",
      platform: "pinterest",
      transport: adapter?.transport || "unconfirmed",
      runsOn: adapter?.transport === "api" ? "Vercel" : "?",
      status: process.env.FACTORY_PINTEREST_ACCESS_TOKEN ? "api-configured" : "token-missing",
      accounts: 0,
      alerts: process.env.FACTORY_PINTEREST_ACCESS_TOKEN ? 0 : 1,
      publishEnabled: adapter?.capabilities.publish ?? true,
      metricsEnabled: adapter?.capabilities.metrics ?? true,
    });
  }
  if (!channelSeed.has("telegram")) {
    const configured = telegramApiConfigured();
    const adapter = getChannelAdapter("telegram");
    channelSeed.set("telegram", {
      id: "telegram",
      name: "Telegram",
      platform: "telegram",
      transport: "api",
      runsOn: "Vercel",
      status: configured ? "api-configured" : "token-missing",
      accounts: 0,
      alerts: configured ? 0 : 1,
      publishEnabled: adapter?.capabilities.publish ?? true,
      metricsEnabled: adapter?.capabilities.metrics ?? false,
    });
  }
  const channelsAll = Array.from(channelSeed.values());

  const worker = workerSnapshot.worker;
  const workerState = worker?.liveness.state || "unknown";
  const workerDiagnostics = buildWorkerHeartbeatDiagnostics({
    dbError: workerSnapshot.db_error,
    workerSource: worker?.source || "unknown",
    workerLastSeen: worker?.last_seen || null,
  });
  const alertsAll: AlertItem[] = [];
  if (workerState === "stale" || workerState === "dead") {
    alertsAll.push({
      id: "worker-heartbeat",
      kind: "worker",
      severity: workerState === "dead" ? "err" : "warn",
      title: workerState === "dead" ? "Воркер офлайн" : "Воркер застаивается",
      account: "railway-content-factory",
      channel: "worker",
      time: worker?.last_seen || null,
      evidence: workerDiagnostics?.detail || `heartbeat ${workerState}`,
      action: workerState === "dead" ? "Проверить heartbeat sender" : "Открыть worker screen",
      stream: "all",
    });
  }
  for (const account of fleetAll) {
    if (account.health === "banned") {
      alertsAll.push({
        id: `ban-${account.id}`,
        kind: "account",
        severity: "err",
        title: `Аккаунт ${account.handle} забанен`,
        account: account.handle,
        channel: account.platform,
        time: account.lastPost,
        evidence: account.banEvidence || "health_state=banned",
        action: "Списать / расследовать",
        stream: account.stream,
      });
    } else if (account.session === false) {
      alertsAll.push({
        id: `login-${account.id}`,
        kind: "session",
        severity: "warn",
        title: `Нужен логин: ${account.handle}`,
        account: account.handle,
        channel: account.platform,
        time: account.lastPost,
        evidence: "session_valid=false",
        action: "Войти вручную",
        stream: account.stream,
      });
    } else if (account.health === "captcha") {
      alertsAll.push({
        id: `captcha-${account.id}`,
        kind: "captcha",
        severity: "warn",
        title: `Captcha pressure: ${account.handle}`,
        account: account.handle,
        channel: account.platform,
        time: account.lastPost,
        evidence: "health_state=captcha",
        action: "Проверить прокси",
        stream: account.stream,
      });
    }
  }
  for (const publication of publications) {
    if (publication.status === "failed") {
      alertsAll.push({
        id: `pub-fail-${publication.id}`,
        kind: "publication",
        severity: publication.error?.toLowerCase().includes("banned") ? "err" : "warn",
        title: `${platformLabel(publication.platform)} publish failed`,
        account: publication.account,
        channel: publication.platform,
        time: publication.updatedAt,
        evidence: publication.error || text(publication.metadata.adapter_failure, 160) || "unknown failure",
        action: publication.error?.toLowerCase().includes("login") ? "Войти вручную" : "Повторить / расследовать",
        stream: publication.stream,
      });
    }
    if (publication.status === "scheduled" && publication.mode === "paid") {
      const target = targetsById.get(publication.targetId);
      const compliance = target?.config.compliance_status;
      if (compliance !== "approved") {
        alertsAll.push({
          id: `compliance-${publication.id}`,
          kind: "compliance",
          severity: "warn",
          title: `${platformLabel(publication.platform)} slot locked by compliance`,
          account: publication.account,
          channel: publication.platform,
          time: publication.scheduledAt,
          evidence: `compliance_status=${compliance || "unknown"}`,
          action: "Проверить ERID / токен",
          stream: publication.stream,
        });
      }
    }
  }
  for (const warning of warnings.slice(0, 6)) {
    alertsAll.push({
      id: `warning-${alertsAll.length + 1}`,
      kind: "system",
      severity: "warn",
      title: systemWarningTitle(warning),
      account: "system",
      channel: "publishing",
      time: generatedAt,
      evidence: warning,
      action: "Проверить API / схему",
      stream: "all",
    });
  }

  const calendarBase = publications
    .filter((publication) => publication.scheduledAt || publication.publishedAt)
    .slice(0, 32)
    .map((publication) => {
      const timeIso = publication.scheduledAt || publication.publishedAt;
      const target = targetsById.get(publication.targetId);
      const complianceLocked = publication.mode === "paid" && target?.config.compliance_status !== "approved";
      return {
        id: publication.id,
        day: timeIso ? new Date(timeIso).toISOString().slice(0, 10) : generatedAt.slice(0, 10),
        group: publication.account,
        platform: publication.platform,
        article: publication.article,
        state: complianceLocked ? "locked" : publication.status as CalendarSlot["state"],
        time: timeIso,
        complianceLocked,
      };
    });

  const filteredFleet = applyStream(fleetAll, stream);
  const filteredRuns = applyStream(runsAll.map((row) => ({ ...row, stream: publications.find((pub) => pub.id === row.id)?.stream || "all" })), stream).map(({ stream: _stream, ...row }) => row);
  const filteredBank = applyStream(bankAll.length ? bankAll : bankFallback, stream);
  const filteredMetrics = applyStream(metricsAll, stream);
  const filteredAlerts = applyStream(alertsAll, stream);
  const filteredCalendar = applyStream(calendarBase.map((row) => ({ ...row, stream: publications.find((pub) => pub.id === row.id)?.stream || "all" })), stream).map(({ stream: _stream, ...row }) => row);
  const filteredChannels = channelsAll.filter((channel) => {
    if (stream === "all") return true;
    const hasAccountsInStream = filteredFleet.some((account) => account.platform === channel.platform);
    return hasAccountsInStream || channel.platform === "pinterest" || channel.platform === "telegram";
  });

  const healthBucketsSeed: Record<string, HealthBucket> = {
    active: { key: "active", label: "Active", count: 0, color: "#BEF34A" },
    warming: { key: "warming", label: "Warming", count: 0, color: "#FFB23E" },
    cooling: { key: "cooling", label: "Cooling", count: 0, color: "#3FD8E6" },
    captcha: { key: "captcha", label: "Captcha", count: 0, color: "#FFB23E" },
    "needs-login": { key: "needs-login", label: "Needs login", count: 0, color: "#FF5E5E" },
    banned: { key: "banned", label: "Banned", count: 0, color: "#FF5E5E" },
    "proxy-flip": { key: "proxy-flip", label: "Proxy flip", count: 0, color: "#FF8A5B" },
  };
  for (const account of filteredFleet) {
    if (!healthBucketsSeed[account.health]) healthBucketsSeed[account.health] = { key: account.health, label: account.health, count: 0, color: "#9298A2" };
    healthBucketsSeed[account.health].count += 1;
  }
  const health = Object.values(healthBucketsSeed).filter((bucket) => bucket.count > 0);

  const overviewTiles: OverviewTile[] = [
    { id: "ready", label: "Готово к выкладке", value: filteredBank.filter((item) => item.status === "ready").length, delta: 3, targetScreen: "bank", spark: sampleSpark(filteredBank.length + 3) },
    { id: "scheduled", label: "В расписании", value: filteredCalendar.filter((item) => item.state === "scheduled" || item.state === "locked").length, delta: 2, targetScreen: "calendar", spark: sampleSpark(filteredCalendar.length + 2) },
    { id: "live", label: "Постится сейчас", value: filteredRuns.filter((item) => item.status === "publishing").length, delta: 1, targetScreen: "runs", spark: sampleSpark(filteredRuns.length + 1) },
    { id: "published24h", label: "Опубликовано 24ч", value: publications.filter((publication) => (stream === "all" || publication.stream === stream) && publication.status === "published" && (timerSecFromTime(publication.publishedAt) || 999999) <= 86400).length, delta: 4, targetScreen: "runs", spark: sampleSpark(12, 5) },
    { id: "winners", label: "Победителей 7д", value: filteredMetrics.filter((item) => item.status === "winner").length, delta: 1, targetScreen: "metrics", spark: sampleSpark(filteredMetrics.length + 1) },
    { id: "alerts", label: "Активных тревог", value: filteredAlerts.length, delta: filteredAlerts.filter((item) => item.severity === "err").length, targetScreen: "alerts", spark: sampleSpark(filteredAlerts.length + 1) },
  ];

  const coverage: CoverageMap = {
    bank: !recipesRes.warning || !contentAssetsRes.warning,
    calendar: !pubsRes.warning,
    fleet: !targetsRes.warning,
    runs: !pubsRes.warning,
    metrics: !metricsRes.warning || metricsRes.warning.includes("legacy read fallback"),
    channels: true,
    alerts: true,
  };
  const mergedWarnings = uniqWarnings([...warnings, ...m6Ops.warnings].filter((warning) => !isNonBlockingWarning(warning)));
  const mode: CockpitMode = mergedWarnings.length ? "partial" : "full";

  const topWinnerMetric = filteredMetrics
    .filter((item) => item.status === "winner")
    .sort((a, b) => b.views - a.views)[0] || null;
  const topWinnerRecipe = topWinnerMetric
    ? recipesRes.rows.find((row) => (Number(row.id) || 0) > 0 && (text(row.article, 80) || `recipe-${Number(row.id)}`) === topWinnerMetric.article)
    : null;
  const improvementNiche = text(topWinnerRecipe?.niche, 80) || null;

  let improvementHints = "";
  let winnerPresetCount = 0;
  if (improvementNiche) {
    try {
      improvementHints = await learningHints(db as any, improvementNiche);
    } catch { /* best-effort */ }
    const presetCountRes = await safeCount(db, "node_templates", [["from_winner", true], ["niche", improvementNiche]]);
    if (presetCountRes.warning) mergedWarnings.push(presetCountRes.warning);
    winnerPresetCount = presetCountRes.count;
  }

  const improvementLoop = {
    ready: Boolean(topWinnerMetric && (improvementHints || winnerPresetCount > 0)),
    niche: improvementNiche,
    winners7d: filteredMetrics.filter((item) => item.status === "winner").length,
    winnerPresets: winnerPresetCount,
    learningHints: improvementHints,
    nextStep: topWinnerMetric
      ? improvementHints || winnerPresetCount > 0
        ? `Следующий цикл можно собирать вокруг ниши ${improvementNiche || "winner"}`
        : "Winner найден, но learning hints/presets ещё не читаются в clean pod"
      : "Пока нет winner-метрик, чтобы замкнуть improvement loop на следующую генерацию",
  };

  return {
    ok: true,
    configured: true,
    mode,
    stream,
    generatedAt,
    warnings: mergedWarnings,
    readEvidence,
    coverage,
    worker: {
      online: workerState === "alive",
      state: workerState,
      source: worker?.source || "unknown",
      lastSeen: worker?.last_seen || null,
      currentTask: worker?.current_task_title || null,
      branch: worker?.branch || null,
      diagnostics: workerDiagnostics,
    },
    overview: {
      tiles: overviewTiles,
      liveRuns: filteredRuns.slice(0, 6).map((row) => ({
        id: row.id,
        platform: row.platform,
        account: row.account,
        article: row.article,
        stage: row.stage,
        timerSec: row.timerSec,
        status: row.status,
        attemptLabel: row.attemptLabel,
      })),
      attention: filteredAlerts.slice(0, 4).map((alert) => ({
        id: alert.id,
        severity: alert.severity,
        title: alert.title,
        detail: `${platformLabel(alert.channel)} · ${alert.evidence}`,
        targetScreen:
          alert.kind === "worker"
            ? "alerts"
            : alert.kind === "publication"
              ? "runs"
              : alert.kind === "system"
                ? systemWarningTargetScreen(alert.evidence)
                : "fleet",
      })),
      health,
    },
    improvementLoop,
    bank: filteredBank.slice(0, 80),
    calendar: filteredCalendar,
    fleet: filteredFleet,
    runs: filteredRuns,
    metrics: filteredMetrics,
    channels: filteredChannels,
    alerts: filteredAlerts,
  };
}
