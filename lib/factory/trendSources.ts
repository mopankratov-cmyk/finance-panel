// Авто-источники залетевших видео для Трендоскопа. Провайдер-абстракция: Apify / Virlo.
// Вызовы идут с нашего сервера; скрап выполняется у провайдера (гео-блок РФ не мешает).
// Активируется ключом: APIFY_TOKEN (+APIFY_ACTOR) или VIRLO_API_KEY. Trendsee — позже, если дадут API.
import { normalizeTargetPlatform } from "./reelsBrainPlaybook";

export type TrendProvider = "apify" | "apify_tiktok" | "apify_instagram" | "apify_youtube" | "virlo";
type TrendPlatform = "tiktok" | "instagram" | "youtube";
export interface ViralVideo {
  url?: string;
  caption?: string;
  title?: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  followers?: number;
  platform?: string;
  sound_id?: string;
  sound_title?: string;
  published_at?: string;
}

const TREND_PROVIDER_PREFERENCE: TrendProvider[] = [
  "apify_tiktok",
  "apify_instagram",
  "apify_youtube",
  "virlo",
  "apify",
];

export function hasTrendSource(): boolean {
  return !!(process.env.APIFY_TOKEN || process.env.VIRLO_API_KEY);
}
export function hasTrendProvider(provider: TrendProvider): boolean {
  if (provider === "apify") return !!process.env.APIFY_TOKEN;
  if (provider === "apify_tiktok") return !!(process.env.APIFY_TOKEN && (process.env.APIFY_TIKTOK_ACTOR || process.env.APIFY_ACTOR));
  if (provider === "apify_instagram") return !!(process.env.APIFY_TOKEN && process.env.APIFY_INSTAGRAM_REELS_ACTOR);
  if (provider === "apify_youtube") return !!(process.env.APIFY_TOKEN && process.env.APIFY_YOUTUBE_ACTOR);
  if (provider === "virlo") return !!process.env.VIRLO_API_KEY;
  return false;
}
export function availableTrendProviders(): TrendProvider[] {
  return TREND_PROVIDER_PREFERENCE.filter((provider) => hasTrendProvider(provider));
}
export function preferredTrendProvider(): TrendProvider | null {
  return availableTrendProviders()[0] || null;
}

export function providerPlatforms(provider: TrendProvider): TrendPlatform[] {
  if (provider === "apify_tiktok" || provider === "virlo") return ["tiktok"];
  if (provider === "apify_instagram") return ["instagram"];
  if (provider === "apify_youtube") return ["youtube"];
  if (provider === "apify") return ["tiktok", "instagram", "youtube"];
  return [];
}

export function prioritizeTrendProviders(targetPlatform: unknown, providers = availableTrendProviders()): TrendProvider[] {
  const normalized = normalizeTargetPlatform(targetPlatform);
  const platform: TrendPlatform = normalized === "instagram" || normalized === "youtube" ? normalized : "tiktok";
  const unique = Array.from(new Set(providers)).filter((provider) => hasTrendProvider(provider));
  return unique
    .slice()
    .sort((a, b) => {
      const aPlatforms = providerPlatforms(a);
      const bPlatforms = providerPlatforms(b);
      const aSpecialized = aPlatforms.length === 1 ? 1 : 0;
      const bSpecialized = bPlatforms.length === 1 ? 1 : 0;
      if (aSpecialized !== bSpecialized) return bSpecialized - aSpecialized;
      const aExact = aPlatforms.includes(platform) ? 1 : 0;
      const bExact = bPlatforms.includes(platform) ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      return TREND_PROVIDER_PREFERENCE.indexOf(a) - TREND_PROVIDER_PREFERENCE.indexOf(b);
    });
}

export function trendSourceName(): string {
  return preferredTrendProvider() || "none";
}

const num = (v: unknown) => (Number(v) || 0);
const apifyActorPath = (actor: string) => actor.trim().replace(/\//g, "~");

function hashtagSeeds(niche: string): string[] {
  const tokens = niche
    .toLowerCase()
    .replace(/[^a-zа-я0-9#\s_-]+/gi, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^#/, "").trim())
    .filter((token) => token.length >= 3 && !["reels", "reel", "review", "обзор"].includes(token));
  const compact = tokens.join("");
  return Array.from(new Set([compact, ...tokens].filter(Boolean))).slice(0, 5);
}

function instagramDirectUrls(niche: string): string[] {
  const urls = niche.match(/https?:\/\/[^\s"']+/g) || [];
  const direct = urls
    .map((url) => url.replace(/[),.;]+$/, ""))
    .filter((url) => /instagram\.com|instagr\.am/i.test(url));
  const hashtags = hashtagSeeds(niche).map((tag) => `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`);
  return Array.from(new Set([...direct, ...hashtags])).slice(0, 8);
}

function tiktokActorInput(niche: string, limit: number) {
  return {
    searchQueries: [niche],
    queries: [niche],
    search: [niche],
    keyword: niche,
    keywords: [niche],
    hashtags: hashtagSeeds(niche),
    maxItems: limit,
    resultsPerPage: limit,
    resultsLimit: limit,
    maxResults: limit,
    maxProfilesPerQuery: 1,
    searchSection: "",
    excludePinnedPosts: false,
    scrapeRelatedVideos: false,
    shouldDownloadAvatars: false,
    shouldDownloadCovers: false,
    shouldDownloadMusicCovers: false,
    shouldDownloadSlideshowImages: false,
    shouldDownloadSubtitles: false,
    shouldDownloadVideos: false,
    proxyCountryCode: "None",
    proxy: { useApifyProxy: true },
  };
}

function tiktokActorCandidates(actor?: string): string[] {
  return Array.from(new Set([
    actor,
    "clockworks/tiktok-scraper",
    "clockworks/free-tiktok-scraper",
  ].filter(Boolean) as string[]));
}

export async function debugApifyTiktokSearch(query: string, limit = 3) {
  const token = process.env.APIFY_TOKEN || "";
  const actor = process.env.APIFY_TIKTOK_ACTOR || process.env.APIFY_ACTOR || "lexis-solutions~tiktok-trending-videos-scraper";
  if (!token) return { configured: false, error: "APIFY_TOKEN missing", actors: [] };
  const input = tiktokActorInput(query, Math.max(1, Math.min(10, limit)));
  const actors = [];
  for (const actorName of tiktokActorCandidates(actor)) {
    const actorPath = apifyActorPath(actorName);
    const started = Date.now();
    try {
      const res = await fetch(`https://api.apify.com/v2/acts/${actorPath}/run-sync-get-dataset-items?token=${token}&maxItems=${limit}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(30000),
      });
      const text = await res.text();
      let parsed: unknown = null;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      const items = Array.isArray(parsed) ? parsed : [];
      actors.push({
        actor: actorName,
        status: res.status,
        ok: res.ok,
        elapsed_ms: Date.now() - started,
        item_count: items.length,
        first_keys: items[0] && typeof items[0] === "object" ? Object.keys(items[0] as Record<string, unknown>).slice(0, 20) : [],
        body_preview: res.ok ? undefined : text.slice(0, 500),
      });
    } catch (error) {
      actors.push({
        actor: actorName,
        status: "FETCH_ERROR",
        ok: false,
        elapsed_ms: Date.now() - started,
        item_count: 0,
        first_keys: [],
        body_preview: String(error instanceof Error ? error.message : error).slice(0, 500),
      });
    }
  }
  return { configured: true, query, input_keys: Object.keys(input), actors };
}

// Apify: запускаем актор синхронно и забираем dataset. Актор задаётся APIFY_ACTOR
// (по умолч. TikTok trending scraper). Вход — общий, лишние поля актор игнорит.
async function fromApify(niche: string, limit: number, opts: { actor?: string; platform?: string } = {}): Promise<ViralVideo[]> {
  const token = process.env.APIFY_TOKEN!;
  const actor = opts.actor || process.env.APIFY_ACTOR || "lexis-solutions~tiktok-trending-videos-scraper";
  const platform = opts.platform || "tiktok";
  const input = {
    searchQueries: [niche],
    queries: [niche],
    search: niche,
    keyword: niche,
    keywords: [niche],
    hashtags: [niche.replace(/\s+/g, "")],
    maxItems: limit,
    resultsPerPage: limit,
    resultsLimit: limit,
    maxResults: limit,
    countryCode: "RU",
    proxy: { useApifyProxy: true },
  };
  const actorInput = platform === "instagram"
    ? {
      ...input,
      directUrls: instagramDirectUrls(niche),
      resultsType: "posts",
      resultsLimit: limit,
      search: niche,
      searchType: "hashtag",
      addParentData: false,
      onlyPostsNewerThan: "30 days",
    }
    : platform === "tiktok"
      ? tiktokActorInput(niche, limit)
    : input;
  const runActor = async (actorName: string) => {
    const actorPath = apifyActorPath(actorName);
    const r = await fetch(`https://api.apify.com/v2/acts/${actorPath}/run-sync-get-dataset-items?token=${token}&maxItems=${limit}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(actorInput), signal: AbortSignal.timeout(55000),
    });
    if (!r.ok) return [];
    const items = (await r.json().catch(() => [])) as Record<string, unknown>[];
    return (Array.isArray(items) ? items : []).slice(0, limit).map((it) => ({
      url: (it.webVideoUrl || it.url || it.postPage || it.shortUrl || it.videoUrl || (it.shortCode ? `https://www.instagram.com/reel/${it.shortCode}/` : "")) as string,
      caption: (it.text || it.caption || it.title || it.desc || it.description || it.alt || "") as string,
      views: num(it.playCount ?? it.views ?? it.viewCount ?? it.videoViewCount ?? it.videoPlayCount),
      likes: num(it.diggCount ?? it.likes ?? it.likeCount ?? it.likesCount),
      comments: num(it.commentCount ?? it.comments ?? it.commentsCount ?? it.commentsCount),
      shares: num(it.shareCount ?? it.shares ?? it.sharesCount),
      followers: num(
        (it.authorMeta as Record<string, unknown> | undefined)?.fans ??
        (it.authorMeta as Record<string, unknown> | undefined)?.followers ??
        (it.authorStats as Record<string, unknown> | undefined)?.followerCount ??
        it.followers,
      ),
      platform: String(it.platform || platform),
      sound_id: String((it.musicMeta as Record<string, unknown> | undefined)?.musicId ?? it.musicId ?? it.sound_id ?? ""),
      sound_title: String((it.musicMeta as Record<string, unknown> | undefined)?.musicName ?? it.musicName ?? it.sound_title ?? ""),
      published_at: String(it.createTimeISO ?? it.createTime ?? it.date ?? it.timestamp ?? ""),
    })).filter((v) => v.caption || v.url);
  };
  try {
    const actorCandidates = platform === "instagram"
      ? Array.from(new Set([actor, "apify/instagram-scraper", "apify/instagram-hashtag-scraper"]))
      : platform === "tiktok"
        ? tiktokActorCandidates(actor)
        : [actor];
    for (const actorName of actorCandidates) {
      const videos = await runActor(actorName);
      if (videos.length) return videos;
    }
    return [];
  } catch { return []; }
}

// Virlo через MCP (Streamable HTTP, JSON-RPC). VIRLO_API_KEY = токен, VIRLO_MCP_URL — эндпоинт.
async function virloCall(method: string, params: unknown): Promise<unknown> {
  const key = process.env.VIRLO_API_KEY!;
  const url = process.env.VIRLO_MCP_URL || "https://dev.virlo.ai/api/mcp/mcp";
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(50000),
  });
  const t = await r.text();
  const line = t.split("\n").find((l) => l.startsWith("data:"));
  try { return JSON.parse(line ? line.slice(5).trim() : t); } catch { return null; }
}

async function fromVirlo(niche: string, limit: number): Promise<ViralVideo[]> {
  try {
    await virloCall("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "factory", version: "1" } });
    const res = (await virloCall("tools/call", { name: "get_trending_videos", arguments: { platform: "tiktok", limit, query: niche || undefined } })) as { result?: { content?: { type: string; text?: string }[] } } | null;
    const textBlock = res?.result?.content?.find((b) => b.type === "text")?.text;
    if (!textBlock) return [];
    const data = (JSON.parse(textBlock) as { data?: Record<string, unknown>[] }).data || [];
    return data.slice(0, limit).map((it) => ({
      url: (it.url || "") as string,
      caption: (it.description || "") as string,
      views: num(it.views),
      likes: num(it.number_of_likes ?? it.likes),
      comments: num(it.number_of_comments ?? it.comments ?? it.comment_count),
      shares: num(it.number_of_shares ?? it.shares ?? it.share_count),
      followers: num((it.author as Record<string, unknown> | undefined)?.followers ?? (it.author as Record<string, unknown> | undefined)?.follower_count ?? it.followers),
      platform: String(it.platform || "tiktok"),
      sound_id: String((it.sound as Record<string, unknown> | undefined)?.id ?? it.sound_id ?? ""),
      sound_title: String((it.sound as Record<string, unknown> | undefined)?.title ?? it.sound_title ?? ""),
      published_at: String(it.published_at ?? it.created_at ?? it.date ?? ""),
    })).filter((v) => v.caption || v.url);
  } catch { return []; }
}

// ── Virlo Orbit: продукт-ориентированный поиск по ключевым фразам (асинхронный) ──
async function virloInitCall(method: string, params: unknown): Promise<unknown> {
  await virloCall("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "factory", version: "1" } });
  return virloCall(method, params);
}
function virloToolJson(res: unknown): Record<string, unknown> | null {
  const t = (res as { result?: { content?: { type: string; text?: string }[] } } | null)?.result?.content?.find((b) => b.type === "text")?.text;
  if (!t) return null;
  try { return JSON.parse(t) as Record<string, unknown>; } catch { return null; }
}
// Остаток баланса Virlo (get_credit_balance — бесплатный вызов). Тот же серверный путь, что и остальные
// вызовы Virlo (MCP-over-HTTP, VIRLO_API_KEY). Ответ: { balance:"$15.00", credits_remaining:1500, status }.
// Возвращаем USD-баланс (парсим "$15.00" → 15; фолбэк credits_remaining/100) + сырой ответ.
export async function virloBalance(): Promise<{ balance: number | null; currency: string; raw?: unknown; error?: string }> {
  if (!process.env.VIRLO_API_KEY) return { balance: null, currency: "USD", error: "VIRLO_API_KEY не настроен" };
  try {
    const res = await virloInitCall("tools/call", { name: "get_credit_balance", arguments: {} });
    const j = virloToolJson(res);
    if (!j) return { balance: null, currency: "USD", error: "Virlo вернул пустой/непарсируемый ответ" };
    const balStr = j.balance != null ? String(j.balance).replace(/[^0-9.\-]/g, "") : "";
    let n = Number(balStr);
    if (!Number.isFinite(n) && j.credits_remaining != null) n = Number(j.credits_remaining) / 100; // 1 credit = $0.01
    if (!Number.isFinite(n)) return { balance: null, currency: "USD", error: "поле баланса не найдено", raw: j };
    return { balance: n, currency: "USD", raw: j };
  } catch (e) { return { balance: null, currency: "USD", error: String(e).slice(0, 140) }; }
}

// Запустить Orbit-поиск по фразам. Возвращает job_id (или null).
export async function virloSearchStart(keywords: string[], platforms: string[] = ["tiktok", "youtube", "instagram"], period = "this_month"): Promise<string | null> {
  if (!process.env.VIRLO_API_KEY) return null;
  const res = await virloInitCall("tools/call", { name: "search_keywords", arguments: { name: `factory ${keywords[0] || ""}`.slice(0, 60), keywords: keywords.slice(0, 7), time_period: period, platforms } });
  const j = virloToolJson(res);
  const data = (j?.data as Record<string, unknown>) || j;
  return (data?.id || data?.job_id || null) as string | null;
}
// Забрать результат/статус Orbit. dataType: status|videos|analysis|trends|outliers.
// extraArgs — для пагинации видео (limit/offset): ответ videos приходит как { data: { total, limit:50, offset, videos:[...] } },
// поэтому орбиты с >50 видео (у нас есть 110 и 127) нужно тянуть страницами через offset.
export async function virloSearchResult(id: string, dataType = "status", extraArgs: Record<string, unknown> = {}): Promise<Record<string, unknown> | null> {
  if (!process.env.VIRLO_API_KEY) return null;
  const res = await virloInitCall("tools/call", { name: "get_keyword_search_results", arguments: { id, data_type: dataType, ...extraArgs } });
  return virloToolJson(res);
}

export async function fetchViral(niche: string, limit = 20): Promise<ViralVideo[]> {
  const provider = preferredTrendProvider();
  return provider ? fetchViralFromProvider(provider, niche, limit) : [];
}

export async function fetchViralFromProvider(provider: TrendProvider, niche: string, limit = 20): Promise<ViralVideo[]> {
  if (provider === "apify" && process.env.APIFY_TOKEN) return fromApify(niche, limit);
  if (provider === "apify_tiktok" && process.env.APIFY_TOKEN) return fromApify(niche, limit, { actor: process.env.APIFY_TIKTOK_ACTOR || process.env.APIFY_ACTOR, platform: "tiktok" });
  if (provider === "apify_instagram" && process.env.APIFY_TOKEN) return fromApify(niche, limit, { actor: process.env.APIFY_INSTAGRAM_REELS_ACTOR || "apify/instagram-scraper", platform: "instagram" });
  if (provider === "apify_youtube" && process.env.APIFY_TOKEN && process.env.APIFY_YOUTUBE_ACTOR) return fromApify(niche, limit, { actor: process.env.APIFY_YOUTUBE_ACTOR, platform: "youtube" });
  if (provider === "virlo" && process.env.VIRLO_API_KEY) return fromVirlo(niche, limit);
  return [];
}

// ── Virlo: list existing orbits (reads free) ────────────────────────────────────────────────────────
export async function virloListOrbits(limit = 50): Promise<{ id: string; name: string; status: string; totalVideos: number }[]> {
  if (!process.env.VIRLO_API_KEY) return [];
  try {
    const res = await virloInitCall("tools/call", { name: "list_keyword_searches", arguments: { limit } });
    const j = virloToolJson(res);
    const data = (j?.data as Record<string, unknown>) || {};
    const orbits = Array.isArray((data as Record<string, unknown>).orbits) ? ((data as Record<string, unknown>).orbits as { id: string; name: string; status: string; totalVideos: number }[]) : [];
    return orbits;
  } catch { return []; }
}

// ── Virlo: niche monitors ──────────────────────────────────────────────────────────────────────────

// Создать Comet-монитор для ниши (однократно, платный шаг ~$1-2).
// Возвращает monitor_id или null.
export interface VirloCreateResult { id: string | null; error?: string; }
export async function virloCreateMonitor(niche: string, keywords: string[], platforms = ["tiktok", "instagram"]): Promise<VirloCreateResult> {
  if (!process.env.VIRLO_API_KEY) return { id: null, error: "VIRLO_API_KEY не настроен" };
  try {
    const res = await virloInitCall("tools/call", { name: "create_niche_monitor", arguments: { name: `wb-factory-${niche}`, keywords: keywords.slice(0, 7), platforms, frequency: "weekly" } });
    // MCP-level error (JSON-RPC error) — surface it instead of swallowing into null.
    const rpcErr = (res as { error?: { message?: string } } | null)?.error?.message;
    if (rpcErr) return { id: null, error: `Virlo MCP error: ${String(rpcErr).slice(0, 160)}` };
    const j = virloToolJson(res);
    if (!j) return { id: null, error: "Virlo вернул пустой/непарсируемый ответ (нет text-блока)" };
    if (j.error) return { id: null, error: `Virlo error: ${String(j.error).slice(0, 160)}` };
    const data = ((j.data as Record<string, unknown>) || j) as Record<string, unknown>;
    if (data.error) return { id: null, error: `Virlo error: ${String(data.error).slice(0, 160)}` };
    // id монитора может лежать как data.id или data.monitor_id (или вложен в data.monitor.* — терпим и это).
    const monitor = (data.monitor && typeof data.monitor === "object" ? (data.monitor as Record<string, unknown>) : null);
    const id = data.id ?? data.monitor_id ?? monitor?.id ?? monitor?.monitor_id ?? null;
    if (id == null) return { id: null, error: `monitor_id не найден; ключи ответа: [${Object.keys(data).slice(0, 8).join(", ")}]` };
    return { id: String(id) };
  } catch (e) { return { id: null, error: String(e).slice(0, 160) }; }
}

// Список существующих Comet-мониторов (читает бесплатно).
export async function virloListMonitors(): Promise<{ id: string; name: string; status: string }[]> {
  if (!process.env.VIRLO_API_KEY) return [];
  try {
    const res = await virloInitCall("tools/call", { name: "list_niche_monitors", arguments: {} });
    const j = virloToolJson(res);
    // Дамп вернул пусто → форма не подтверждена. Терпим ОБА варианта: { data: [...] } и { data: { monitors: [...] } }
    // (последнее зеркалит подтверждённый list_keyword_searches → data.orbits).
    const d = (j as Record<string, unknown> | null)?.data;
    const arr = Array.isArray(d)
      ? d
      : (d && typeof d === "object" && Array.isArray((d as Record<string, unknown>).monitors) ? (d as Record<string, unknown>).monitors : []);
    const data = arr as { id: string; name: string; status: string }[];
    return data.filter((m) => m && m.id);
  } catch { return []; }
}

// Данные монитора: новые видео из Comet с момента last_checked (читает бесплатно).
export async function virloMonitorData(monitorId: string): Promise<Record<string, unknown>[]> {
  if (!process.env.VIRLO_API_KEY) return [];
  try {
    const res = await virloInitCall("tools/call", { name: "get_niche_monitor_data", arguments: { id: monitorId } });
    const j = virloToolJson(res);
    // По общему правилу дампа массив лежит на один уровень глубже под именованным ключом (зеркало data.videos).
    // Терпим: { data: [...] }, { data: { videos: [...] } } и { data: { data: [...] } }.
    const d = (j as Record<string, unknown> | null)?.data;
    const arr = Array.isArray(d)
      ? d
      : (d && typeof d === "object"
          ? (Array.isArray((d as Record<string, unknown>).videos) ? (d as Record<string, unknown>).videos
            : Array.isArray((d as Record<string, unknown>).data) ? (d as Record<string, unknown>).data
            : [])
          : []);
    return arr as Record<string, unknown>[];
  } catch { return []; }
}

// ── Virlo: deep video analysis ────────────────────────────────────────────────────────────────────

export interface VirloVideoAnalysis {
  hook_text?: string;
  format_detected?: string;

  beat_structure?: any;

  viral_reason?: any;
  is_commerce_safe?: boolean;
}

function cleanedText(value: unknown, max = 220): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function firstHookLine(value: string): string {
  const line = value
    .split(/[\n.!?]+/)
    .map((part) => cleanedText(part, 160))
    .find(Boolean);
  return line || cleanedText(value, 160);
}

function inferFormatFromCaption(caption: string): string {
  const s = caption.toLowerCase();
  if (!s) return "unknown_structure";
  if (/unboxing|распаков/.test(s)) return "unboxing";
  if (/review|обзор|тест|test/.test(s)) return "review";
  if (/before|after|до и после|до\/после/.test(s)) return "before_after";
  if (/лайфхак|lifehack|hack/.test(s)) return "life_hack";
  if (/pov/.test(s)) return "pov";
  if (/prank|розыгрыш/.test(s)) return "prank";
  if (/demo|демо|show|смотри/.test(s)) return "demo";
  return "unknown_structure";
}

export function hasUsableVirloAnalysis(analysis: VirloVideoAnalysis | null | undefined): boolean {
  if (!analysis) return false;
  return !!(
    cleanedText(analysis.hook_text)
    || cleanedText(analysis.format_detected)
    || analysis.beat_structure
    || analysis.viral_reason
  );
}

export function fallbackVirloAnalysis(input: { caption?: string | null; url?: string | null }): VirloVideoAnalysis | null {
  const caption = cleanedText(input.caption, 500);
  if (!caption) return null;
  return {
    hook_text: firstHookLine(caption),
    format_detected: inferFormatFromCaption(caption),
    beat_structure: null,
    viral_reason: {
      source: "caption_fallback",
      note: "Virlo returned empty analysis; fallback inferred from caption.",
      url: cleanedText(input.url, 500) || null,
    },
    is_commerce_safe: true,
  };
}

// Глубокий анализ видео: hook_text, формат, beat_structure, причина вирусности (читает бесплатно).
export async function virloAnalyzeVideo(url: string): Promise<VirloVideoAnalysis | null> {
  if (!process.env.VIRLO_API_KEY) return null;
  try {
    const res = await virloInitCall("tools/call", { name: "analyze_video", arguments: { url } });
    const j = virloToolJson(res);
    if (!j || j.error) return null;
    // Как и все вызовы Virlo, payload завёрнут в .data; падаем на j, если .data нет (analyze_video в дампе не снят).
    const data = ((j.data as Record<string, unknown>) || j) as Record<string, unknown>;
    if (!data || data.error) return null;
    return {
      hook_text: (data.hook_text || data.hook || "") as string,
      format_detected: (data.format || data.format_detected || data.content_type || "") as string,
      beat_structure: data.beat_structure || data.beats || null,
      viral_reason: data.viral_reason || data.why_viral || null,
      is_commerce_safe: typeof data.is_commerce_safe === "boolean" ? data.is_commerce_safe : true,
    };
  } catch { return null; }
}
