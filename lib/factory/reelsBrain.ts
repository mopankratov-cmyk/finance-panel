export type ReelsPlatform = "tiktok" | "instagram" | "youtube" | "unknown";
export type ReelsSourceType = "manual" | "keyword" | "hashtag" | "creator" | "sound" | "provider";

export interface ReelsBrainInput {
  url?: string;
  video_url?: string;
  media_url?: string;
  image_url?: string;
  canonical_url?: string;
  platform?: string;
  caption?: string;
  title?: string;
  description?: string;
  author?: string;
  username?: string;
  views?: unknown;
  likes?: unknown;
  comments?: unknown;
  comments_count?: unknown;
  shares?: unknown;
  followers?: unknown;
  followers_creator?: unknown;
  author_followers?: unknown;
  duration_sec?: unknown;
  duration?: unknown;
  published_at?: string;
  date?: string;
  hashtags?: unknown;
  sound_id?: string;
  sound_title?: string;
  transcript?: string;
}

export interface NormalizedReelsVideo {
  platform: ReelsPlatform;
  url: string;
  canonicalUrl: string;
  mediaUrl: string | null;
  videoId: string | null;
  caption: string | null;
  transcript: string | null;
  author: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  followers: number | null;
  durationSec: number | null;
  publishedAt: string | null;
  hashtags: string[];
  soundId: string | null;
  soundTitle: string | null;
}

export interface ViralScoreBreakdown {
  views: number;
  engagement: number;
  outlier: number;
  recency: number;
  completeness: number;
  missingPenalty: number;
  total: number;
}

export interface ViralVideoInsertRow {
  niche: string;
  platform: string;
  url: string;
  views: number | null;
  likes: number | null;
  followers_creator: number | null;
  virality_score: number | null;
  caption: string | null;
  sound_id: string | null;
  sound_title: string | null;
  source_orbit_id: string | null;
  analyzed: false;
}

const TRACKING_PARAMS = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid", "igsh", "si"]);

function sourceOrbitId(provider: string, source: string | undefined): string {
  const cleanProvider = String(provider || "unknown").trim().slice(0, 80) || "unknown";
  const cleanSource = String(source || "manual").replace(/\s+/g, " ").trim().slice(0, 160) || "manual";
  return `${cleanProvider}:q:${encodeURIComponent(cleanSource)}`;
}

export function toFiniteNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const compact = String(value).trim().toLowerCase().replace(/\s+/g, "");
  const thousandsComma = /^-?\d{1,3}(,\d{3})+(?:[a-zа-я]+)?$/i.test(compact);
  const decimalComma = /^-?\d+,\d{1,2}(?:[a-zа-я]+)?$/i.test(compact);
  const normalized = (thousandsComma
    ? compact.replace(/,/g, "")
    : decimalComma
      ? compact.replace(/,/g, ".")
      : compact)
    .replace(/тыс\.?|k$/i, "k")
    .replace(/млн\.?|m$/i, "m");
  const match = normalized.match(/^(-?\d+(?:\.\d+)?)([km])?$/i);
  if (!match) {
    const digits = normalized.replace(/[^0-9.\-]/g, "");
    if (!digits) return null;
    const parsed = Number(digits);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const mult = match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1;
  const result = base * mult;
  return mult === 1 ? result : Math.round(result);
}

export function toIsoDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? value.toISOString() : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const epoch = value > 1e12 ? value : value * 1000;
    const date = new Date(epoch);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{9,13}$/.test(raw)) {
    const epoch = Number(raw.length >= 13 ? raw : raw) * (raw.length >= 13 ? 1 : 1000);
    const date = new Date(epoch);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return raw;
  return new Date(parsed).toISOString();
}

function cleanText(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const s = value.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

export function inferPlatform(urlOrPlatform?: string): ReelsPlatform {
  const value = (urlOrPlatform || "").toLowerCase();
  if (/tiktok|douyin/.test(value)) return "tiktok";
  if (/instagram|instagr\.am/.test(value)) return "instagram";
  if (/youtube|youtu\.be/.test(value)) return "youtube";
  return "unknown";
}

export function canonicalizeReelsUrl(rawUrl: string): { canonicalUrl: string; videoId: string | null; platform: ReelsPlatform } {
  const fallback = rawUrl.trim();
  try {
    const url = new URL(fallback);
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    const platform = inferPlatform(url.hostname);
    let videoId: string | null = null;

    if (platform === "youtube") {
      if (url.hostname.includes("youtu.be")) videoId = url.pathname.split("/").filter(Boolean)[0] || null;
      else if (url.pathname.startsWith("/shorts/")) videoId = url.pathname.split("/").filter(Boolean)[1] || null;
      else videoId = url.searchParams.get("v");
      if (videoId) return { canonicalUrl: `https://www.youtube.com/shorts/${videoId}`, videoId, platform };
    }

    if (platform === "tiktok") {
      const parts = url.pathname.split("/").filter(Boolean);
      const videoIdx = parts.indexOf("video");
      videoId = videoIdx >= 0 ? parts[videoIdx + 1] || null : null;
      url.hostname = "www.tiktok.com";
      return { canonicalUrl: url.toString().replace(/\/$/, ""), videoId, platform };
    }

    if (platform === "instagram") {
      const parts = url.pathname.split("/").filter(Boolean);
      const markerIdx = parts.findIndex((p) => p === "reel" || p === "p" || p === "tv");
      videoId = markerIdx >= 0 ? parts[markerIdx + 1] || null : null;
      if (videoId && markerIdx >= 0) return { canonicalUrl: `https://www.instagram.com/${parts[markerIdx]}/${videoId}/`, videoId, platform };
    }

    return { canonicalUrl: url.toString().replace(/\/$/, ""), videoId, platform };
  } catch {
    return { canonicalUrl: fallback, videoId: null, platform: inferPlatform(fallback) };
  }
}

function parseHashtags(value: unknown, caption: string | null): string[] {
  const out = new Set<string>();
  if (Array.isArray(value)) {
    for (const item of value) {
      const tag = String(item || "").replace(/^#/, "").trim().toLowerCase();
      if (tag) out.add(tag);
    }
  }
  if (caption) {
    for (const match of caption.matchAll(/#([\p{L}\p{N}_-]+)/gu)) out.add(match[1].toLowerCase());
  }
  return Array.from(out).slice(0, 30);
}

export function normalizeReelsVideo(input: ReelsBrainInput): NormalizedReelsVideo | null {
  const rawUrl = cleanText(input.url || input.video_url || input.canonical_url, 1200);
  if (!rawUrl) return null;
  const canonical = canonicalizeReelsUrl(rawUrl);
  const caption = cleanText(input.caption || input.title || input.description);
  const platform = inferPlatform(input.platform) !== "unknown" ? inferPlatform(input.platform) : canonical.platform;
  return {
    platform,
    url: rawUrl,
    canonicalUrl: canonical.canonicalUrl,
    mediaUrl: cleanText(input.video_url || input.media_url || input.image_url, 1200),
    videoId: canonical.videoId,
    caption,
    transcript: cleanText(input.transcript, 6000),
    author: cleanText(input.author || input.username, 180),
    views: toFiniteNumber(input.views),
    likes: toFiniteNumber(input.likes),
    comments: toFiniteNumber(input.comments ?? input.comments_count),
    shares: toFiniteNumber(input.shares),
    followers: toFiniteNumber(input.followers ?? input.followers_creator ?? input.author_followers),
    durationSec: toFiniteNumber(input.duration_sec ?? input.duration),
    publishedAt: toIsoDate(input.published_at || input.date) || cleanText(input.published_at || input.date, 120),
    hashtags: parseHashtags(input.hashtags, caption),
    soundId: cleanText(input.sound_id, 240),
    soundTitle: cleanText(input.sound_title, 500),
  };
}

function recencyBoost(publishedAt: string | null, now = Date.now()): number {
  if (!publishedAt) return 0;
  const normalized = toIsoDate(publishedAt) || publishedAt;
  const t = Date.parse(normalized);
  if (!Number.isFinite(t)) return 0;
  const days = Math.max(0, (now - t) / 86400000);
  if (days <= 14) return 3;
  if (days <= 45) return 2;
  if (days <= 120) return 1;
  return 0;
}

export function scoreReelsVideo(video: NormalizedReelsVideo, now = Date.now()): ViralScoreBreakdown {
  const views = video.views ?? 0;
  const likes = video.likes ?? 0;
  const comments = video.comments ?? 0;
  const shares = video.shares ?? 0;
  const followers = video.followers ?? 0;
  const engagementCount = likes + comments * 2 + shares * 3;
  const engagementRate = views > 0 ? engagementCount / views : 0;
  const viewsScore = views > 0 ? Math.log10(views + 1) * 5 : 0;
  const engagementScore = Math.min(12, engagementRate * 120);
  const outlierScore = views > 0 && followers > 0 ? Math.min(16, Math.log((views / Math.max(followers, 100)) + 1) * 7) : 0;
  const completeness = [
    video.caption,
    video.author,
    video.views,
    video.likes,
    video.followers,
    video.soundTitle || video.soundId,
    video.publishedAt,
  ].filter((v) => v != null && v !== "").length;
  const completenessScore = completeness * 0.7;
  const missingPenalty = video.views == null ? 5 : (video.likes == null ? 1.5 : 0) + (video.followers == null ? 1.5 : 0);
  const total = viewsScore + engagementScore + outlierScore + recencyBoost(video.publishedAt, now) + completenessScore - missingPenalty;
  return {
    views: Math.round(viewsScore * 10) / 10,
    engagement: Math.round(engagementScore * 10) / 10,
    outlier: Math.round(outlierScore * 10) / 10,
    recency: recencyBoost(video.publishedAt, now),
    completeness: Math.round(completenessScore * 10) / 10,
    missingPenalty: Math.round(missingPenalty * 10) / 10,
    total: Math.max(0, Math.round(total * 10) / 10),
  };
}

export function makeViralVideoRows(
  inputs: ReelsBrainInput[],
  opts: { niche: string; sourceProvider: string; sourceQuery?: string; sourceType?: ReelsSourceType },
): { rows: ViralVideoInsertRow[]; rejected: number; normalized: NormalizedReelsVideo[] } {
  const niche = (opts.niche || "default").trim() || "default";
  const seen = new Set<string>();
  const rows: ViralVideoInsertRow[] = [];
  const normalized: NormalizedReelsVideo[] = [];
  let rejected = 0;

  for (const input of inputs) {
    const video = normalizeReelsVideo(input);
    if (!video) { rejected++; continue; }
    const key = video.canonicalUrl || video.url;
    if (seen.has(key)) continue;
    seen.add(key);
    const score = scoreReelsVideo(video).total;
    normalized.push(video);
    rows.push({
      niche,
      platform: video.platform === "unknown" ? "unknown" : video.platform,
      url: video.canonicalUrl,
      views: video.views,
      likes: video.likes,
      followers_creator: video.followers,
      virality_score: score || null,
      caption: video.caption,
      sound_id: video.soundId,
      sound_title: video.soundTitle,
      source_orbit_id: sourceOrbitId(opts.sourceProvider, opts.sourceQuery || opts.sourceType || "manual"),
      analyzed: false,
    });
  }

  return { rows, rejected, normalized };
}
