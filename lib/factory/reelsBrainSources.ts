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
  toIsoDate,
  type NormalizedReelsVideo,
  type ReelsBrainInput,
} from "./reelsBrain";

export type BrightDataProvider = "bright_tiktok" | "bright_instagram" | "bright_instagram_post" | "bright_youtube";
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
  platformStats: Record<string, {
    found: number;
    valid: number;
    relevant: number;
    avgScore: number;
    withFollowers: number;
    withSound: number;
  }>;
  top: { url: string; platform: string; score: number; views: number | null; caption: string | null }[];
}

export interface ProviderBakeOffAggregate {
  provider: ReelsBrainProvider;
  configured: boolean;
  runs: number;
  found: number;
  valid: number;
  valid_rate: number;
  relevant: number;
  relevance_rate: number;
  avg_score: number;
  with_followers: number;
  with_sound: number;
  avg_elapsed_ms?: number;
  timeout_runs?: number;
  failed_runs?: number;
  cost_tier?: "low" | "medium" | "high";
}

export interface RankedProvider extends ProviderBakeOffAggregate {
  rank_score: number;
  rank_reason: string;
}

export interface ProviderPlatformBakeOffAggregate extends ProviderBakeOffAggregate {
  platform: "tiktok" | "instagram" | "youtube";
}

function providerCostTier(provider: ReelsBrainProvider): "low" | "medium" | "high" {
  if (provider === "apify" || provider.startsWith("apify_") || provider === "youtube") return "low";
  if (provider.startsWith("ensemble_")) return "medium";
  if (provider === "virlo" || provider.startsWith("bright_")) return "high";
  return "medium";
}

function providerCostPenalty(tier: "low" | "medium" | "high"): number {
  if (tier === "low") return 0;
  if (tier === "medium") return 20;
  return 45;
}

const YOUTUBE_KEY = () => process.env.YOUTUBE_API_KEY || process.env.GOOGLE_YOUTUBE_API_KEY || "";
const BRIGHT_KEY = () => process.env.BRIGHT_DATA_API_KEY || process.env.BRIGHTDATA_API_KEY || "";
const BRIGHT_BASE_URL = () => process.env.BRIGHT_DATA_API_URL || "https://api.brightdata.com";
const ENSEMBLE_KEY = () => process.env.ENSEMBLEDATA_API_KEY || process.env.ENSEMBLE_DATA_API_KEY || "";
const ENSEMBLE_BASE_URL = () => process.env.ENSEMBLEDATA_BASE_URL || "https://ensembledata.com/apis";

const BRIGHT_DATASET_IDS: Record<BrightDataProvider, string> = {
  bright_tiktok: process.env.BRIGHT_DATA_TIKTOK_DATASET_ID || "gd_lu702nij2f790tmv9h",
  bright_instagram: process.env.BRIGHT_DATA_INSTAGRAM_REELS_DATASET_ID || "gd_lyclm20il4r5helnj",
  bright_instagram_post: process.env.BRIGHT_DATA_INSTAGRAM_POSTS_DATASET_ID || "gd_lk5ns7kz21pck8jpis",
  bright_youtube: process.env.BRIGHT_DATA_YOUTUBE_DATASET_ID || "gd_lk56epmy2i5g7lzu0k",
};

const STOP_WORDS = new Set([
  "обзор", "отзыв", "тест", "распаковка", "находки", "маркетплейс", "для", "что", "как", "это", "the", "and", "for", "with", "review", "viral", "product",
]);
const BRIGHT_PROVIDERS: BrightDataProvider[] = ["bright_tiktok", "bright_instagram", "bright_instagram_post", "bright_youtube"];
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
  if (provider === "apify_instagram") return !!process.env.APIFY_TOKEN;
  if (provider === "youtube") return !!YOUTUBE_KEY();
  if (isBrightProvider(provider)) return !!BRIGHT_KEY();
  if (isEnsembleProvider(provider)) return !!ENSEMBLE_KEY();
  return hasTrendProvider(provider);
}

export function availableReelsBrainProviders(): ReelsBrainProvider[] {
  const providers: ReelsBrainProvider[] = [...availableTrendProviders()];
  if (process.env.APIFY_TOKEN && !providers.includes("apify_instagram")) providers.push("apify_instagram");
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

function firstObjectUrl(value: unknown): string | undefined {
  const items = arrayValue(value);
  for (const item of items) {
    const found = str(rec(item).url, rec(item).src, rec(item).play_addr, rec(item).download_addr);
    if (found) return found;
  }
  return undefined;
}

function firstMediaUrl(value: unknown): string | undefined {
  const items = arrayValue(value);
  for (const item of items) {
    if (typeof item === "string" && item.trim()) return item.trim();
    const found = str(rec(item).url, rec(item).src);
    if (found) return found;
  }
  return undefined;
}

function firstChildVideoUrl(value: unknown): string | undefined {
  const items = arrayValue(value);
  for (const item of items) {
    const found = str(rec(item).videoUrl, rec(item).video_url);
    if (found) return found;
  }
  return undefined;
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
    root.users,
    root.profiles,
    root.accounts,
    root.edges,
    root.aweme_list,
    root.data,
    data.data,
    data.items,
    data.results,
    data.posts,
    data.videos,
    data.reels,
    data.users,
    data.profiles,
    data.accounts,
    data.edges,
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
    video_url: str(
      firstMediaUrl(row.mediaUrls),
      rec(row.videoMeta).downloadAddr,
      firstUrlList(rec(video.play_addr)),
      firstUrlList(rec(video.download_addr)),
      firstUrlList(rec(video.playAddr)),
      firstUrlList(rec(video.downloadAddr)),
      firstObjectUrl(video.bit_rate),
      row.video_url,
      row.videoUrl,
      row.play_url,
      row.playUrl,
      row.download_url,
      row.downloadUrl,
      row.webVideoUrl,
    ),
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
    published_at: toIsoDate(aweme.create_time ?? row.create_time ?? row.createTimeISO ?? row.date_posted ?? row.published_at)
      || str(aweme.create_time, row.create_time, row.createTimeISO, row.date_posted, row.published_at),
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
  const postContent = arrayValue(row.post_content);
  const firstVideoContent = postContent.find((item) => str(rec(item).type)?.toLowerCase() === "video");
  const firstPhotoContent = postContent.find((item) => str(rec(item).type)?.toLowerCase() === "photo");
  const rowVideos = arrayValue(row.videos);
  const rowImages = arrayValue(row.images);
  const url = str(media.url, row.url) || (code ? `https://www.instagram.com/reel/${code}/` : undefined);
  const videoUrl = str(
    media.video_url,
    row.videoUrl,
    firstChildVideoUrl(row.childPosts),
    firstObjectUrl(media.video_versions),
    firstObjectUrl(rowVideos),
    str(firstVideoContent && rec(firstVideoContent).url),
    row.video_url,
    row.videoUrl,
    row.video_versions?.[0]?.url,
  );
  const imageUrl = str(
    row.thumbnail,
    Array.isArray(row.photos) ? row.photos[0] : null,
    str(firstPhotoContent && rec(firstPhotoContent).url),
    firstObjectUrl(rowImages),
  );
  return {
    url,
    video_url: videoUrl,
    media_url: videoUrl || imageUrl,
    image_url: imageUrl,
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

function instagramRowDirectVideoUrl(row: Record<string, any>): string | undefined {
  const media = rec(row.media || row.reel || row.post || row);
  const postContent = arrayValue(row.post_content);
  const rowVideos = arrayValue(row.videos);
  const firstVideoContent = postContent.find((item) => str(rec(item).type)?.toLowerCase() === "video");
  return str(
    media.video_url,
    firstObjectUrl(media.video_versions),
    firstObjectUrl(rowVideos),
    str(firstVideoContent && rec(firstVideoContent).url),
    row.video_url,
    row.videoUrl,
    row.video_versions?.[0]?.url,
  );
}

function instagramRowHasVideoSignal(row: Record<string, any>): boolean {
  if (instagramRowDirectVideoUrl(row)) return true;
  const media = rec(row.media || row.reel || row.post || row);
  const postContent = arrayValue(row.post_content);
  const contentHints = [
    str(media.media_type, media.product_type, row.content_type, row.product_type),
    ...postContent.map((item) => str(rec(item).type, rec(item).content_type, rec(item).product_type)),
  ]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());

  return contentHints.some((value) => /video|clip|clips|reel|igtv/.test(value));
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

function directPlatformUrl(query: string): { platform: "tiktok" | "instagram" | "youtube"; url: string } | null {
  const target = str(query);
  if (!target || !/^https?:\/\//i.test(target)) return null;
  if (/tiktok\.com\//i.test(target)) return { platform: "tiktok", url: target };
  if (/instagram\.com\//i.test(target)) return { platform: "instagram", url: target };
  if (/youtube\.com\/shorts\/|youtu\.be\//i.test(target)) return { platform: "youtube", url: target };
  return null;
}

function syntheticDirectUrlInput(query: string): ReelsBrainInput[] {
  const direct = directPlatformUrl(query);
  if (!direct) return [];
  return [{ url: direct.url, platform: direct.platform }];
}

function shouldShortCircuitDirectUrl(provider: ReelsBrainProvider, query: string): boolean {
  const direct = directPlatformUrl(query);
  if (!direct) return false;
  if (provider === "apify_tiktok" || provider === "apify_instagram" || provider === "apify_youtube") return false;
  return provider === "youtube";
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

function brightInstagramPostInputs(query: string): { input: Record<string, unknown>[]; params: Record<string, string> } {
  const queryUrls = urlsFromText(query, "instagram");
  const postUrls = queryUrls.filter((url) => /\/p\//i.test(url));
  if (!postUrls.length) {
    throw new Error("bright_instagram_post требует Instagram post URL (/p/...)");
  }
  return {
    input: Array.from(new Set(postUrls)).slice(0, 10).map((url) => ({ url })),
    params: { dataset_id: BRIGHT_DATASET_IDS.bright_instagram_post },
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
  if (provider === "bright_instagram_post") {
    const { input, params } = brightInstagramPostInputs(query);
    const rows = await brightScrape(input, params);
    return rows
      .filter((row) => Boolean(instagramRowDirectVideoUrl(row)))
      .map((row) => apiRowToInput("instagram", row))
      .filter((video) => video.url && shortFormOnly(video))
      .slice(0, limit);
  }
  const { input, params } = brightInstagramInputs(query, limit);
  const rows = await brightScrape(input, params);
  return rows
    .filter((row) => instagramRowHasVideoSignal(row))
    .map((row) => apiRowToInput("instagram", row))
    .filter((video) => video.url && shortFormOnly(video))
    .slice(0, limit);
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

async function ensembleGetRaw(path: string, params: Record<string, string | number | boolean>): Promise<{ status: number; ok: boolean; text: string; json: unknown }> {
  const url = new URL(path.replace(/^\//, ""), ENSEMBLE_BASE_URL().replace(/\/?$/, "/"));
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  url.searchParams.set("token", ENSEMBLE_KEY());
  const res = await fetch(url, { signal: AbortSignal.timeout(45000) });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, text, json };
}

function instagramUserIdsFromSearch(rows: Record<string, any>[]): string[] {
  const ids: string[] = [];
  const visit = (value: unknown, depth = 0) => {
    if (depth > 3 || value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const row = rec(value);
    if (!Object.keys(row).length) return;
    const user = rec(row.user || row.profile || row.account || row.owner || row.node || row);
    const id = str(
      user.pk,
      user.pk_id,
      user.id,
      user.user_id,
      user.instagram_id,
      user.igid,
      row.pk,
      row.pk_id,
      row.id,
      row.user_id,
      row.instagram_id,
      row.igid,
    );
    if (id && /^\d+$/.test(id)) ids.push(id);
    for (const key of ["users", "items", "results", "data", "profiles", "edges"]) {
      if (row[key] != null) visit(row[key], depth + 1);
    }
  };
  for (const row of rows) {
    visit(row);
  }
  return Array.from(new Set(ids)).slice(0, 3);
}

function sampleShape(value: unknown, depth = 0): unknown {
  if (depth > 2 || value == null) return null;
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      first: sampleShape(value[0], depth + 1),
    };
  }
  if (typeof value !== "object") return typeof value;
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).slice(0, 20);
  const out: Record<string, unknown> = { type: "object", keys };
  for (const key of keys.slice(0, 8)) {
    const item = row[key];
    if (Array.isArray(item) || (item && typeof item === "object")) out[key] = sampleShape(item, depth + 1);
    else out[key] = typeof item;
  }
  return out;
}

function collectUrlishFields(value: unknown, prefix = "", depth = 0, out: Array<{ path: string; value: string }> = []): Array<{ path: string; value: string }> {
  if (depth > 4 || value == null) return out;
  if (Array.isArray(value)) {
    value.slice(0, 6).forEach((item, index) => collectUrlishFields(item, `${prefix}[${index}]`, depth + 1, out));
    return out;
  }
  if (typeof value !== "object") return out;
  const row = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(row).slice(0, 80)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof item === "string") {
      const lower = key.toLowerCase();
      if ((/^https?:\/\//i.test(item) || item.includes(".mp4")) && (
        lower.includes("url")
        || lower.includes("video")
        || lower.includes("play")
        || lower.includes("download")
        || lower.includes("src")
      )) {
        out.push({ path, value: item.slice(0, 500) });
      }
      continue;
    }
    collectUrlishFields(item, path, depth + 1, out);
  }
  return out;
}

export async function debugBrightInstagramQuery(query: string, limit = 1): Promise<Record<string, unknown>> {
  if (!BRIGHT_KEY()) return { configured: false, error: "BRIGHT_DATA_API_KEY не настроен" };
  const { input, params } = brightInstagramInputs(query, Math.max(1, Math.min(limit, 3)));
  const rows = await brightScrape(input, params);
  const first = rows[0] || null;
  return {
    configured: true,
    query,
    count: rows.length,
    input,
    params,
    first_shape: sampleShape(first),
    first_keys: first ? Object.keys(first).slice(0, 120) : [],
    urlish_fields: collectUrlishFields(first).slice(0, 80),
    normalized_sample: first ? instagramInput(first) : null,
  };
}

export async function debugBrightInstagramPostQuery(query: string): Promise<Record<string, unknown>> {
  if (!BRIGHT_KEY()) return { configured: false, error: "BRIGHT_DATA_API_KEY не настроен" };
  const { input, params } = brightInstagramPostInputs(query);
  const rows = await brightScrape(input, params);
  const first = rows[0] || null;
  return {
    configured: true,
    query,
    count: rows.length,
    input,
    params,
    first_shape: sampleShape(first),
    first_keys: first ? Object.keys(first).slice(0, 120) : [],
    urlish_fields: collectUrlishFields(first).slice(0, 80),
    normalized_sample: first ? instagramInput(first) : null,
  };
}

export async function debugEnsembleInstagramSearch(query: string): Promise<Record<string, unknown>> {
  if (!ENSEMBLE_KEY()) return { configured: false, error: "ENSEMBLEDATA_API_KEY не настроен" };
  const raw = await ensembleGetRaw("/instagram/search", { text: query });
  const rows = recordsFromPayload(raw.json);
  const root = rec(raw.json);
  return {
    configured: true,
    status: raw.status,
    ok: raw.ok,
    detail: typeof root.detail === "string" ? root.detail.slice(0, 300) : undefined,
    text_length: raw.text.length,
    root_shape: sampleShape(raw.json),
    parsed_records: rows.length,
    parsed_sample_shape: sampleShape(rows[0]),
    candidate_user_ids: instagramUserIdsFromSearch(rows),
  };
}

function instagramSearchQueries(query: string): string[] {
  const base = query.trim();
  const cleaned = base
    .replace(/\breels?\b/gi, "")
    .replace(/\binstagram\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(new Set([
    base,
    cleaned,
    `${cleaned || base} shop`,
    `${cleaned || base} review`,
    `${cleaned || base} blogger`,
  ].map((row) => row.trim()).filter(Boolean))).slice(0, 4);
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
  let userIds = directUserId ? [directUserId] : [];
  if (!userIds.length) {
    for (const searchQuery of instagramSearchQueries(query)) {
      const rows = await ensembleGet("/instagram/search", { text: searchQuery }).catch(() => []);
      userIds = instagramUserIdsFromSearch(rows);
      if (userIds.length) break;
    }
  }
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
    if (shouldShortCircuitDirectUrl(provider, query) && syntheticDirectUrlInput(query).length) {
      return {
        provider,
        query,
        configured: true,
        elapsedMs: Date.now() - started,
        videos: syntheticDirectUrlInput(query),
      };
    }
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
        video_url: v.video_url,
        platform: v.platform,
        caption: v.caption || v.title,
        title: v.title,
        transcript: v.transcript,
        author: v.author,
        username: v.username,
        views: v.views,
        likes: v.likes,
        comments: v.comments,
        shares: v.shares,
        followers: v.followers,
        duration_sec: v.duration_sec,
        hashtags: v.hashtags,
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
  const foundByPlatform: Record<string, number> = {};
  for (const input of videos) {
    const rawPlatform = String(input.platform || "").trim().toLowerCase() || "unknown";
    foundByPlatform[rawPlatform] = (foundByPlatform[rawPlatform] || 0) + 1;
    const video = normalizeReelsVideo(input);
    if (!video) continue;
    const key = video.canonicalUrl || video.url;
    if (seen.has(key)) { duplicateCanonical++; continue; }
    seen.add(key);
    normalized.push(video);
  }

  const platforms: Record<string, number> = {};
  for (const video of normalized) platforms[video.platform] = (platforms[video.platform] || 0) + 1;
  const relevantByPlatform: Record<string, number> = {};
  for (const video of videos) {
    const platform = String(video.platform || "").trim().toLowerCase() || "unknown";
    if (isRelevantToQuery(query, video)) relevantByPlatform[platform] = (relevantByPlatform[platform] || 0) + 1;
  }
  const scored = normalized
    .map((video) => ({ video, score: scoreReelsVideo(video).total }))
    .sort((a, b) => b.score - a.score);
  const relevant = videos.filter((video) => isRelevantToQuery(query, video)).length;
  const platformScoreSums: Record<string, number> = {};
  const platformFollowers: Record<string, number> = {};
  const platformSound: Record<string, number> = {};
  for (const { video, score } of scored) {
    platformScoreSums[video.platform] = (platformScoreSums[video.platform] || 0) + score;
    if (video.followers != null) platformFollowers[video.platform] = (platformFollowers[video.platform] || 0) + 1;
    if (video.soundId || video.soundTitle) platformSound[video.platform] = (platformSound[video.platform] || 0) + 1;
  }
  const platformStats: ProviderQualitySummary["platformStats"] = {};
  for (const platform of new Set([
    ...Object.keys(foundByPlatform),
    ...Object.keys(platforms),
    ...Object.keys(relevantByPlatform),
  ])) {
    const valid = platforms[platform] || 0;
    platformStats[platform] = {
      found: foundByPlatform[platform] || 0,
      valid,
      relevant: relevantByPlatform[platform] || 0,
      avgScore: valid ? Math.round((platformScoreSums[platform] || 0) / valid * 10) / 10 : 0,
      withFollowers: platformFollowers[platform] || 0,
      withSound: platformSound[platform] || 0,
    };
  }

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
    platformStats,
    top: scored.slice(0, 5).map(({ video, score }) => ({
      url: video.canonicalUrl,
      platform: video.platform,
      score,
      views: video.views,
      caption: video.caption ? video.caption.slice(0, 180) : null,
    })),
  };
}

function providerRankScore(row: ProviderBakeOffAggregate): number {
  if (!row.configured) return Number.NEGATIVE_INFINITY;
  const latencyPenalty = Math.min(120, Math.round((Number(row.avg_elapsed_ms || 0) / 1000) * 8));
  const timeoutPenalty = Math.max(0, Number(row.timeout_runs || 0)) * 30;
  const failurePenalty = Math.max(0, Number(row.failed_runs || 0)) * 18;
  const costPenalty = providerCostPenalty(row.cost_tier || providerCostTier(row.provider));
  return (
    row.relevance_rate * 1000
    + row.valid_rate * 500
    + row.avg_score * 20
    + row.relevant * 3
    + row.valid * 2
    + row.with_followers * 0.1
    + row.with_sound * 0.05
    - latencyPenalty
    - timeoutPenalty
    - failurePenalty
    - costPenalty
  );
}

function providerRankReason(row: ProviderBakeOffAggregate): string {
  return [
    `relevance ${Math.round(row.relevance_rate * 100)}%`,
    `valid ${Math.round(row.valid_rate * 100)}%`,
    `avg score ${row.avg_score}`,
    `relevant ${row.relevant}`,
    `latency ${Math.round(Number(row.avg_elapsed_ms || 0))}ms`,
    `cost ${row.cost_tier || providerCostTier(row.provider)}`,
  ].join(" · ");
}

export function rankBakeOffProviders(rows: ProviderBakeOffAggregate[]): RankedProvider[] {
  return rows
    .map((row) => ({
      ...row,
      rank_score: providerRankScore(row),
      rank_reason: providerRankReason(row),
    }))
    .sort((a, b) =>
      b.rank_score - a.rank_score
      || b.relevant - a.relevant
      || b.valid - a.valid
      || b.avg_score - a.avg_score
      || a.provider.localeCompare(b.provider)
    );
}

export function pickBestBakeOffProvider(rows: ProviderBakeOffAggregate[]): RankedProvider | null {
  return rankBakeOffProviders(rows).find((row) => row.configured && row.relevant > 0 && row.valid > 0) || null;
}

export function pickBestBakeOffProviderByPlatform(rows: ProviderPlatformBakeOffAggregate[]): Record<string, RankedProvider | null> {
  const out: Record<string, RankedProvider | null> = {};
  for (const platform of ["tiktok", "instagram", "youtube"] as const) {
    const platformRows = rows.filter((row) => row.platform === platform);
    out[platform] = pickBestBakeOffProvider(platformRows);
  }
  return out;
}
