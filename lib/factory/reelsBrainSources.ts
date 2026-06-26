import {
  availableTrendProviders,
  fetchViralFromProvider,
  hasTrendProvider,
  type TrendProvider,
} from "./trendSources";
import {
  normalizeReelsVideo,
  scoreReelsVideo,
  toFiniteNumber,
  type NormalizedReelsVideo,
  type ReelsBrainInput,
} from "./reelsBrain";

export type BrightDataProvider = "bright_tiktok" | "bright_instagram" | "bright_youtube";
export type EnsembleDataProvider = "ensemble_tiktok" | "ensemble_instagram" | "ensemble_youtube";
export type ReelsBrainProvider = TrendProvider | "youtube" | BrightDataProvider | EnsembleDataProvider;

export interface ReelsBrainFetchResult {
  provider: ReelsBrainProvider;
  query: string;
  configured: boolean;
  elapsedMs: number;
  videos: ReelsBrainInput[];
  error?: string;
}

export interface ProviderQualitySummary {
  provider: ReelsBrainProvider;
  query: string;
  found: number;
  valid: number;
  relevant: number;
  relevanceRate: number;
  duplicateCanonical: number;
  avgScore: number;
  withViews: number;
  withLikes: number;
  withComments: number;
  withFollowers: number;
  withCaption: number;
  withSound: number;
  platforms: Record<string, number>;
  top: { url: string; platform: string; score: number; views: number | null; caption: string | null }[];
}

const YOUTUBE_KEY = () => process.env.YOUTUBE_API_KEY || process.env.GOOGLE_YOUTUBE_API_KEY || "";
const BRIGHT_KEY = () => process.env.BRIGHT_DATA_API_KEY || process.env.BRIGHTDATA_API_KEY || "";
const BRIGHT_BASE_URL = () => process.env.BRIGHT_DATA_API_URL || "https://api.brightdata.com";
const ENSEMBLE_KEY = () => process.env.ENSEMBLEDATA_API_KEY || process.env.ENSEMBLE_DATA_API_KEY || "";
const ENSEMBLE_BASE_URL = () => process.env.ENSEMBLEDATA_BASE_URL || "https://ensembledata.com/apis";

const BRIGHT_DATASET_IDS: Record<BrightDataProvider, string> = {
  bright_tiktok: process.env.BRIGHT_DATA_TIKTOK_DATASET_ID || "gd_lu702nij2f790tmv9h",
  bright_instagram: process.env.BRIGHT_DATA_INSTAGRAM_REELS_DATASET_ID || "gd_lyclm20il4r5helnj",
  bright_youtube: process.env.BRIGHT_DATA_YOUTUBE_DATASET_ID || "gd_lk56epmy2i5g7lzu0k",
};

const STOP_WORDS = new Set([
  "обзор", "отзыв", "тест", "распаковка", "находки", "маркетплейс", "для", "что", "как", "это", "the", "and", "for", "with", "review", "viral", "product",
]);
const BRIGHT_PROVIDERS: BrightDataProvider[] = ["bright_tiktok", "bright_instagram", "bright_youtube"];
const ENSEMBLE_PROVIDERS: EnsembleDataProvider[] = ["ensemble_tiktok", "ensemble_instagram", "ensemble_youtube"];

function isBrightProvider(provider: ReelsBrainProvider): provider is BrightDataProvider {
  return (BRIGHT_PROVIDERS as string[]).includes(provider);
}

function isEnsembleProvider(provider: ReelsBrainProvider): provider is EnsembleDataProvider {
  return (ENSEMBLE_PROVIDERS as string[]).includes(provider);
}

export function knownReelsBrainProviders(): ReelsBrainProvider[] {
  return [
    "apify",
    "apify_tiktok",
    "apify_instagram",
    "apify_youtube",
    "virlo",
    "youtube",
    ...BRIGHT_PROVIDERS,
    ...ENSEMBLE_PROVIDERS,
  ];
}

export function hasReelsBrainProvider(provider: ReelsBrainProvider): boolean {
  if (provider === "youtube") return !!YOUTUBE_KEY();
  if (isBrightProvider(provider)) return !!BRIGHT_KEY();
  if (isEnsembleProvider(provider)) return !!ENSEMBLE_KEY();
  return hasTrendProvider(provider);
}

export function availableReelsBrainProviders(): ReelsBrainProvider[] {
  const providers: ReelsBrainProvider[] = [...availableTrendProviders()];
  if (YOUTUBE_KEY()) providers.push("youtube");
  if (BRIGHT_KEY()) providers.push(...BRIGHT_PROVIDERS);
  if (ENSEMBLE_KEY()) providers.push(...ENSEMBLE_PROVIDERS);
  return providers;
}

function queryTokens(query: string): string[] {
  return Array.from(new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []))
    .filter((token) => !STOP_WORDS.has(token))
    .slice(0, 8);
}

export function isRelevantToQuery(query: string, input: ReelsBrainInput): boolean {
  const tokens = queryTokens(query);
  if (!tokens.length) return true;
  const haystack = [
    input.caption,
    input.title,
    input.description,
    input.author,
    input.username,
    input.sound_title,
    Array.isArray(input.hashtags) ? input.hashtags.join(" ") : "",
  ].filter(Boolean).join(" ").toLowerCase();
  return tokens.some((token) => haystack.includes(token));
}

export function filterRelevantReelsInputs(query: string, videos: ReelsBrainInput[]): ReelsBrainInput[] {
  return videos.filter((video) => isRelevantToQuery(query, video));
}

function num(v: unknown): number | null {
  return toFiniteNumber(v);
}

function rec(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function firstValue(...values: unknown[]): unknown {
  return values.find((value) => value != null && value !== "");
}

function str(...values: unknown[]): string | undefined {
  const value = firstValue(...values);
  if (value == null) return undefined;
  const out = String(value).trim();
  return out || undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstUrlList(value: unknown): string | undefined {
  const r = rec(value);
  return str(arrayValue(r.url_list)[0], r.url);
}

function textRuns(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const r = rec(value);
  if (typeof r.simpleText === "string") return r.simpleText;
  const runs = arrayValue(r.runs).map((run) => str(rec(run).text)).filter(Boolean);
  if (runs.length) return runs.join("");
  return str(rec(rec(r.accessibility).accessibilityData).label);
}

function parseDurationText(value: unknown): number | null {
  const text = str(value);
  if (!text) return null;
  if (/^\d+(?::\d+)+$/.test(text)) {
    return text.split(":").map(Number).reduce((total, part) => total * 60 + part, 0);
  }
  let seconds = 0;
  const lower = text.toLowerCase();
  const hours = lower.match(/(\d+)\s*(?:h|hour|hours|час|часа|часов)/);
  const minutes = lower.match(/(\d+)\s*(?:m|min|minute|minutes|мин|минут)/);
  const secs = lower.match(/(\d+)\s*(?:s|sec|second|seconds|сек|секунд)/);
  if (hours) seconds += Number(hours[1]) * 3600;
  if (minutes) seconds += Number(minutes[1]) * 60;
  if (secs) seconds += Number(secs[1]);
  return seconds || null;
}

function parseYouTubeDuration(iso?: string): number | null {
  if (!iso) return null;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
}

function recordsFromPayload(payload: unknown): Record<string, any>[] {
  if (Array.isArray(payload)) return payload.map(rec).filter((item) => Object.keys(item).length);
  const root = rec(payload);
  const data = rec(root.data);
  const candidates: unknown[] = [
    root.items,
    root.results,
    root.posts,
    root.videos,
    root.reels,
    root.aweme_list,
    root.data,
    data.data,
    data.items,
    data.results,
    data.posts,
    data.videos,
    data.reels,
    data.aweme_list,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.map(rec).filter((item) => Object.keys(item).length);
  }
  return [];
}

function parseJsonRecords(text: string): Record<string, any>[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    return recordsFromPayload(JSON.parse(trimmed));
  } catch {
    return trimmed
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try { return rec(JSON.parse(line)); } catch { return {}; }
      })
      .filter((item) => Object.keys(item).length);
  }
}

function tiktokInput(row: Record<string, any>): ReelsBrainInput {
  const aweme = rec(row.aweme_info || row.aweme || row);
  const author = rec(aweme.author || row.author || row.authorMeta);
  const stats = rec(aweme.statistics || aweme.stats || row.statistics || row.stats);
  const video = rec(aweme.video || row.video);
  const music = rec(aweme.music || row.music || row.musicMeta);
  const postId = str(aweme.aweme_id, aweme.id, row.post_id, row.aweme_id);
  const username = str(author.unique_id, author.username, row.profile_username, row.username);
  const url = str(aweme.share_url, row.url, row.webVideoUrl, row.postPage)
    || (username && postId ? `https://www.tiktok.com/@${username}/video/${postId}` : undefined);
  const durationMs = num(video.duration ?? aweme.duration);
  return {
    url,
    video_url: str(firstUrlList(rec(video.play_addr)), firstUrlList(rec(video.download_addr)), row.video_url),
    platform: "tiktok",
    caption: str(aweme.desc, aweme.description, row.description, row.caption, row.text, row.title),
    author: str(author.nickname, author.unique_id, author.username, row.profile_username),
    username,
    views: num(stats.play_count ?? row.play_count ?? row.playCount ?? row.views ?? row.viewCount),
    likes: num(stats.digg_count ?? row.digg_count ?? row.diggCount ?? row.likes ?? row.likeCount),
    comments: num(stats.comment_count ?? row.comment_count ?? row.commentCount ?? row.comments),
    shares: num(stats.share_count ?? row.share_count ?? row.shareCount ?? row.shares),
    followers: num(author.follower_count ?? author.fans ?? row.followers),
    duration_sec: durationMs ? Math.round(durationMs / 1000) : num(row.video_duration ?? row.duration),
    published_at: str(aweme.create_time, row.create_time, row.createTimeISO, row.date_posted, row.published_at),
    hashtags: row.hashtags,
    sound_id: str(music.id, music.mid, music.music_id, music.musicId, row.sound_id),
    sound_title: str(music.title, music.music_name, music.musicName, row.sound_title),
  };
}

function instagramInput(row: Record<string, any>): ReelsBrainInput {
  const media = rec(row.media || row.reel || row.post || row);
  const user = rec(media.user || row.user);
  const caption = media.caption && typeof media.caption === "object" ? rec(media.caption).text : media.caption;
  const code = str(media.code, media.shortcode, row.shortcode);
  const url = str(media.url, row.url) || (code ? `https://www.instagram.com/reel/${code}/` : undefined);
  return {
    url,
    video_url: str(media.video_url, row.video_url),
    platform: "instagram",
    caption: str(caption, media.description, row.description, row.caption),
    author: str(user.username, row.user_posted, row.username),
    username: str(user.username, row.user_posted, row.username),
    views: num(media.play_count ?? media.view_count ?? row.video_play_count ?? row.views),
    likes: num(media.like_count ?? row.likes),
    comments: num(media.comment_count ?? row.num_comments ?? row.comments),
    followers: num(user.follower_count ?? row.followers),
    duration_sec: num(media.video_duration ?? media.length ?? row.length ?? row.duration),
    published_at: str(media.taken_at, media.date_posted, row.date_posted, row.published_at),
    hashtags: row.hashtags,
    sound_id: str(media.clips_metadata?.audio_id, row.audio_url),
    sound_title: str(media.clips_metadata?.music_info?.music_asset_info?.title, row.audio_title),
  };
}

function youtubeInput(row: Record<string, any>): ReelsBrainInput {
  const video = rec(row.videoRenderer || row.video || row);
  const endpoint = rec(rec(video.navigationEndpoint).watchEndpoint);
  const metadata = rec(rec(video.navigationEndpoint).commandMetadata);
  const web = rec(metadata.webCommandMetadata);
  const videoId = str(video.videoId, endpoint.videoId, row.video_id, row.id, row.shortcode);
  const url = str(row.url, web.url && `https://www.youtube.com${web.url}`)
    || (videoId ? `https://www.youtube.com/shorts/${videoId}` : undefined);
  const durationText = textRuns(video.lengthText);
  return {
    url,
    video_url: str(row.video_url),
    platform: "youtube",
    caption: str(row.description, textRuns(video.title), row.title),
    title: str(row.title, textRuns(video.title)),
    author: str(row.youtuber, row.handle_name, textRuns(video.longBylineText), textRuns(video.ownerText)),
    views: num(row.views ?? textRuns(video.viewCountText)),
    likes: num(row.likes),
    comments: num(row.num_comments ?? row.comments),
    followers: num(row.subscribers),
    duration_sec: num(row.video_length) ?? parseDurationText(durationText),
    published_at: str(row.date_posted, textRuns(video.publishedTimeText)),
    hashtags: row.tags,
    transcript: str(row.transcript),
  };
}

function apiRowToInput(platform: "tiktok" | "instagram" | "youtube", row: Record<string, any>): ReelsBrainInput {
  if (platform === "tiktok") return tiktokInput(row);
  if (platform === "instagram") return instagramInput(row);
  return youtubeInput(row);
}

function shortFormOnly(input: ReelsBrainInput): boolean {
  const duration = num(input.duration_sec ?? input.duration);
  if (duration == null) return true;
  return duration <= 120;
}

async function fetchYouTubeShorts(query: string, limit: number): Promise<ReelsBrainInput[]> {
  const key = YOUTUBE_KEY();
  if (!key) return [];
  const max = Math.min(50, Math.max(1, limit));
  const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  searchUrl.searchParams.set("part", "snippet");
  searchUrl.searchParams.set("type", "video");
  searchUrl.searchParams.set("videoDuration", "short");
  searchUrl.searchParams.set("order", "viewCount");
  searchUrl.searchParams.set("maxResults", String(max));
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("key", key);

  const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(20000) });
  if (!searchRes.ok) throw new Error(`youtube search ${searchRes.status}`);
  const searchJson = await searchRes.json().catch(() => ({})) as { items?: { id?: { videoId?: string } }[] };
  const ids = (searchJson.items || []).map((it) => it.id?.videoId).filter((id): id is string => !!id).slice(0, max);
  if (!ids.length) return [];

  const detailsUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  detailsUrl.searchParams.set("part", "snippet,statistics,contentDetails");
  detailsUrl.searchParams.set("id", ids.join(","));
  detailsUrl.searchParams.set("key", key);
  const detailsRes = await fetch(detailsUrl, { signal: AbortSignal.timeout(20000) });
  if (!detailsRes.ok) throw new Error(`youtube details ${detailsRes.status}`);
  const detailsJson = await detailsRes.json().catch(() => ({})) as { items?: Record<string, any>[] };

  return (detailsJson.items || [])
    .map((it): ReelsBrainInput => {
      const id = String(it.id || "");
      const snippet = (it.snippet || {}) as Record<string, any>;
      const stats = (it.statistics || {}) as Record<string, any>;
      const durationSec = parseYouTubeDuration((it.contentDetails || {}).duration);
      return {
        url: id ? `https://www.youtube.com/shorts/${id}` : "",
        platform: "youtube",
        caption: [snippet.title, snippet.description].filter(Boolean).join(" — ").slice(0, 2000),
        title: snippet.title,
        author: snippet.channelTitle,
        views: num(stats.viewCount),
        likes: num(stats.likeCount),
        comments: num(stats.commentCount),
        duration_sec: durationSec,
        published_at: snippet.publishedAt,
        hashtags: typeof snippet.description === "string" ? Array.from(snippet.description.matchAll(/#([\p{L}\p{N}_-]+)/gu)).map((m) => m[1]) : [],
      };
    })
    .filter((v) => v.url && (v.duration_sec == null || Number(v.duration_sec) <= 90));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadBrightSnapshot(snapshotId: string): Promise<Record<string, any>[]> {
  const key = BRIGHT_KEY();
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(8000);
    const url = new URL(`/datasets/v3/snapshot/${snapshotId}`, BRIGHT_BASE_URL());
    url.searchParams.set("format", "json");
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(30000),
    });
    if (res.ok) return parseJsonRecords(await res.text());
    if (![202, 404, 409].includes(res.status)) throw new Error(`bright snapshot ${res.status}`);
  }
  throw new Error(`bright snapshot ${snapshotId} ещё готовится`);
}

async function brightScrape(input: Record<string, unknown>[], queryParams: Record<string, string>): Promise<Record<string, any>[]> {
  const key = BRIGHT_KEY();
  const url = new URL("/datasets/v3/scrape", BRIGHT_BASE_URL());
  for (const [name, value] of Object.entries(queryParams)) url.searchParams.set(name, value);
  url.searchParams.set("notify", "false");
  url.searchParams.set("include_errors", "true");
  url.searchParams.set("format", "json");
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
    signal: AbortSignal.timeout(65000),
  });
  const text = await res.text();
  if (res.status === 202) {
    let snapshotId = "";
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      snapshotId = String(json.snapshot_id || json.id || "");
    } catch {}
    if (snapshotId) return downloadBrightSnapshot(snapshotId);
    throw new Error("bright snapshot ещё готовится");
  }
  if (!res.ok) throw new Error(`bright scrape ${res.status}: ${text.slice(0, 120)}`);
  return parseJsonRecords(text);
}

function urlsFromText(value: string, platform: "instagram"): string[] {
  const matches = value.match(/https?:\/\/[^\s"']+/g) || [];
  return matches
    .map((url) => url.replace(/[),.;]+$/, ""))
    .filter((url) => platform === "instagram" ? /instagram\.com|instagr\.am/i.test(url) : true);
}

function brightInstagramInputs(query: string, limit: number): { input: Record<string, unknown>[]; params: Record<string, string> } {
  const queryUrls = urlsFromText(query, "instagram");
  const reelUrls = queryUrls.filter((url) => /\/(reel|p|tv)\//i.test(url));
  if (reelUrls.length) {
    return {
      input: reelUrls.slice(0, limit).map((url) => ({ url })),
      params: { dataset_id: BRIGHT_DATASET_IDS.bright_instagram },
    };
  }

  const profileUrls = [
    ...queryUrls.filter((url) => !/\/(reel|p|tv)\//i.test(url)),
    ...(process.env.BRIGHT_DATA_INSTAGRAM_PROFILE_URLS || "").split(/[\n,]/).map((url) => url.trim()).filter(Boolean),
  ];
  if (!profileUrls.length && /^@[\w.]+$/.test(query.trim())) profileUrls.push(`https://www.instagram.com/${query.trim().slice(1)}`);
  if (!profileUrls.length) {
    throw new Error("bright_instagram требует Instagram profile/reel URL в query или BRIGHT_DATA_INSTAGRAM_PROFILE_URLS");
  }
  return {
    input: Array.from(new Set(profileUrls)).slice(0, 3).map((url) => ({ url, num_of_posts: limit })),
    params: { dataset_id: BRIGHT_DATASET_IDS.bright_instagram, type: "discover_new", discover_by: "url_all_reels" },
  };
}

async function fetchBrightData(provider: BrightDataProvider, query: string, limit: number): Promise<ReelsBrainInput[]> {
  if (provider === "bright_tiktok") {
    const rows = await brightScrape(
      [{ search_keyword: query, num_of_posts: limit }],
      { dataset_id: BRIGHT_DATASET_IDS.bright_tiktok, type: "discover_new", discover_by: "keyword" },
    );
    return rows.map((row) => apiRowToInput("tiktok", row)).filter((input) => input.url).slice(0, limit);
  }
  if (provider === "bright_youtube") {
    const rows = await brightScrape(
      [{ keyword: query, num_of_posts: limit }],
      { dataset_id: BRIGHT_DATASET_IDS.bright_youtube, type: "discover_new", discover_by: "keyword" },
    );
    return rows.map((row) => apiRowToInput("youtube", row)).filter((input) => input.url && shortFormOnly(input)).slice(0, limit);
  }
  const { input, params } = brightInstagramInputs(query, limit);
  const rows = await brightScrape(input, params);
  return rows.map((row) => apiRowToInput("instagram", row)).filter((video) => video.url && shortFormOnly(video)).slice(0, limit);
}

async function ensembleGet(path: string, params: Record<string, string | number | boolean>): Promise<Record<string, any>[]> {
  const url = new URL(path.replace(/^\//, ""), ENSEMBLE_BASE_URL().replace(/\/?$/, "/"));
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  url.searchParams.set("token", ENSEMBLE_KEY());
  const res = await fetch(url, { signal: AbortSignal.timeout(45000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`ensemble ${path} ${res.status}: ${text.slice(0, 120)}`);
  return parseJsonRecords(text);
}

function instagramUserIdsFromSearch(rows: Record<string, any>[]): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    const user = rec(row.user || row);
    const id = str(user.pk, user.pk_id, user.id, user.user_id);
    if (id) ids.push(id);
  }
  return Array.from(new Set(ids)).slice(0, 3);
}

async function fetchEnsembleData(provider: EnsembleDataProvider, query: string, limit: number): Promise<ReelsBrainInput[]> {
  if (provider === "ensemble_tiktok") {
    const rows = await ensembleGet("/tt/keyword/search", {
      name: query,
      cursor: 0,
      period: process.env.ENSEMBLEDATA_TIKTOK_PERIOD || "90",
      sorting: process.env.ENSEMBLEDATA_TIKTOK_SORTING || "1",
      country: process.env.ENSEMBLEDATA_COUNTRY || "us",
      match_exactly: false,
      get_author_stats: true,
    });
    return rows.map((row) => apiRowToInput("tiktok", row)).filter((input) => input.url).slice(0, limit);
  }

  if (provider === "ensemble_youtube") {
    const rows = await ensembleGet("/youtube/search", {
      keyword: query,
      depth: Math.max(1, Math.ceil(limit / 20)),
      period: process.env.ENSEMBLEDATA_YOUTUBE_PERIOD || "month",
      sorting: process.env.ENSEMBLEDATA_YOUTUBE_SORTING || "views",
      get_additional_info: true,
    });
    return rows.map((row) => apiRowToInput("youtube", row)).filter((input) => input.url && shortFormOnly(input)).slice(0, limit);
  }

  const directUserId = /^\d+$/.test(query.trim()) ? query.trim() : "";
  const userIds = directUserId ? [directUserId] : instagramUserIdsFromSearch(await ensembleGet("/instagram/search", { text: query }));
  if (!userIds.length) return [];
  const batches = await Promise.all(userIds.map((userId) => ensembleGet("/instagram/user/reels", {
    user_id: userId,
    depth: Math.max(1, Math.ceil(limit / 10)),
    include_feed_video: true,
    chunk_size: Math.min(20, Math.max(3, limit)),
  }).catch(() => [])));
  return batches.flat().map((row) => apiRowToInput("instagram", row)).filter((input) => input.url && shortFormOnly(input)).slice(0, limit);
}

export async function fetchReelsBrainProvider(provider: ReelsBrainProvider, query: string, limit: number): Promise<ReelsBrainFetchResult> {
  const started = Date.now();
  if (!hasReelsBrainProvider(provider)) {
    return { provider, query, configured: false, elapsedMs: 0, videos: [], error: `${provider} не настроен` };
  }
  try {
    if (provider === "youtube") {
      const videos = await fetchYouTubeShorts(query, limit);
      return { provider, query, configured: true, elapsedMs: Date.now() - started, videos };
    }
    if (isBrightProvider(provider)) {
      const videos = await fetchBrightData(provider, query, limit);
      return { provider, query, configured: true, elapsedMs: Date.now() - started, videos };
    }
    if (isEnsembleProvider(provider)) {
      const videos = await fetchEnsembleData(provider, query, limit);
      return { provider, query, configured: true, elapsedMs: Date.now() - started, videos };
    }

    const videos = await fetchViralFromProvider(provider, query, limit);
    return {
      provider,
      query,
      configured: true,
      elapsedMs: Date.now() - started,
      videos: videos.map((v): ReelsBrainInput => ({
        url: v.url,
        platform: v.platform,
        caption: v.caption || v.title,
        title: v.title,
        views: v.views,
        likes: v.likes,
        comments: v.comments,
        shares: v.shares,
        followers: v.followers,
        sound_id: v.sound_id,
        sound_title: v.sound_title,
        published_at: v.published_at,
      })),
    };
  } catch (e) {
    return { provider, query, configured: true, elapsedMs: Date.now() - started, videos: [], error: String((e as Error)?.message || e).slice(0, 220) };
  }
}

export function summarizeProviderQuality(provider: ReelsBrainProvider, query: string, videos: ReelsBrainInput[]): ProviderQualitySummary {
  const normalized: NormalizedReelsVideo[] = [];
  let duplicateCanonical = 0;
  const seen = new Set<string>();
  for (const input of videos) {
    const video = normalizeReelsVideo(input);
    if (!video) continue;
    const key = video.canonicalUrl || video.url;
    if (seen.has(key)) { duplicateCanonical++; continue; }
    seen.add(key);
    normalized.push(video);
  }

  const platforms: Record<string, number> = {};
  for (const video of normalized) platforms[video.platform] = (platforms[video.platform] || 0) + 1;
  const scored = normalized
    .map((video) => ({ video, score: scoreReelsVideo(video).total }))
    .sort((a, b) => b.score - a.score);
  const relevant = videos.filter((video) => isRelevantToQuery(query, video)).length;

  const count = normalized.length || 1;
  return {
    provider,
    query,
    found: videos.length,
    valid: normalized.length,
    relevant,
    relevanceRate: videos.length ? Math.round(relevant / videos.length * 100) / 100 : 0,
    duplicateCanonical,
    avgScore: Math.round(scored.reduce((sum, item) => sum + item.score, 0) / count * 10) / 10,
    withViews: normalized.filter((v) => v.views != null).length,
    withLikes: normalized.filter((v) => v.likes != null).length,
    withComments: normalized.filter((v) => v.comments != null).length,
    withFollowers: normalized.filter((v) => v.followers != null).length,
    withCaption: normalized.filter((v) => !!v.caption).length,
    withSound: normalized.filter((v) => !!(v.soundId || v.soundTitle)).length,
    platforms,
    top: scored.slice(0, 5).map(({ video, score }) => ({
      url: video.canonicalUrl,
      platform: video.platform,
      score,
      views: video.views,
      caption: video.caption ? video.caption.slice(0, 180) : null,
    })),
  };
}
