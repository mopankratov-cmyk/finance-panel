type MediaStatus = "ready" | "metadata_only" | "blocked" | "unknown";
type NextWorker = "audio_visual" | "metadata_only_pattern_brain" | "manual_resolver_review" | "skip";

const DIRECT_MEDIA_EXTENSIONS = /\.(mp4|mov|m4v|webm|mp3|wav|m4a|aac)(\?|#|$)/i;
const VIDEO_EXTENSIONS = /\.(mp4|mov|m4v|webm)(\?|#|$)/i;
const AUDIO_EXTENSIONS = /\.(mp3|wav|m4a|aac)(\?|#|$)/i;
const IMAGE_HINT = /\.(jpg|jpeg|png|webp|gif|image)(\?|#|$)|\/image(?:\?|$)|tplv-[^/?#]*\.image/i;
const SOCIAL_PAGE_HOSTS = [
  "tiktok.com",
  "instagram.com",
  "youtu.be",
  "youtube.com",
  "youtube-nocookie.com",
];

export type ReelsMediaSourceVideo = {
  id?: number | null;
  url?: string | null;
  platform?: string | null;
  niche?: string | null;
  caption?: string | null;
  sound_title?: string | null;
  virality_score?: number | null;
  views?: number | null;
  analyzed?: boolean | null;
  analyzed_full?: unknown;
  video_url?: string | null;
  download_url?: string | null;
  media_url?: string | null;
  audio_url?: string | null;
};

export type ReelsMediaAssetClassification = {
  video_id: number | null;
  niche: string;
  platform: string;
  status: MediaStatus;
  reason: string;
  asset_url: string | null;
  page_url: string | null;
  asset_kind: "video" | "audio" | "unknown" | null;
  next_worker: NextWorker;
  score: number | null;
};

function asUrl(value: unknown): URL | null {
  try {
    const text = String(value || "").trim();
    if (!/^https?:\/\//i.test(text)) return null;
    return new URL(text);
  } catch {
    return null;
  }
}

function isDirectMedia(value: string | null | undefined): boolean {
  if (!value) return false;
  return DIRECT_MEDIA_EXTENSIONS.test(value);
}

function isSocialPageUrl(value: string | null | undefined): boolean {
  const url = asUrl(value);
  if (!url) return false;
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  return SOCIAL_PAGE_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function assetKind(value: string | null): "video" | "audio" | "unknown" | null {
  if (!value) return null;
  if (VIDEO_EXTENSIONS.test(value)) return "video";
  if (AUDIO_EXTENSIONS.test(value)) return "audio";
  return "unknown";
}

function isProbablyImage(value: string | null | undefined): boolean {
  return !!value && IMAGE_HINT.test(value);
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function collectCandidateUrls(value: unknown, depth = 0): string[] {
  if (!value || depth > 4) return [];
  if (typeof value === "string") return /^https?:\/\//i.test(value.trim()) ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap((item) => collectCandidateUrls(item, depth + 1)).slice(0, 50);
  if (typeof value !== "object") return [];

  const out: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase();
    const likelyMediaKey = /video|download|media|asset|play|audio|url|src/.test(normalizedKey);
    if (likelyMediaKey) out.push(...collectCandidateUrls(child, depth + 1));
  }
  return Array.from(new Set(out)).slice(0, 50);
}

function envelopeAssetCandidate(value: unknown): string | null {
  const root = rec(value);
  const mediaRoot = rec(root.media_assets);
  const assets = Array.isArray(root.assets)
    ? root.assets
    : Array.isArray(mediaRoot.assets)
      ? mediaRoot.assets
      : [];
  for (const asset of assets) {
    const row = rec(asset);
    const url = String(row.url || "").trim();
    const field = String(row.field || "").toLowerCase();
    const kind = String(row.kind || "").toLowerCase();
    const usableKind = kind === "video" || kind === "audio" || field === "video_url" || field === "download_url" || field === "audio_url";
    if (usableKind && /^https?:\/\//i.test(url) && !isSocialPageUrl(url) && !isProbablyImage(url)) return url;
  }
  return null;
}

function directAssetCandidate(video: ReelsMediaSourceVideo): string | null {
  const directFields = [
    video.video_url,
    video.download_url,
    video.media_url,
    video.audio_url,
  ].map((row) => String(row || "").trim()).filter(Boolean);
  const likelyDirectField = directFields.find((candidate) => /^https?:\/\//i.test(candidate) && !isSocialPageUrl(candidate) && !isProbablyImage(candidate));
  if (likelyDirectField) return likelyDirectField;
  const envelopeDirect = envelopeAssetCandidate(video.analyzed_full);
  if (envelopeDirect) return envelopeDirect;
  const analyzedCandidates = collectCandidateUrls(video.analyzed_full);
  return [...directFields, video.url || "", ...analyzedCandidates].find((candidate) => isDirectMedia(candidate)) || null;
}

export function classifyReelsMediaAsset(video: ReelsMediaSourceVideo): ReelsMediaAssetClassification {
  const direct = directAssetCandidate(video);
  if (direct) {
    return {
      video_id: Number(video.id || 0) || null,
      niche: String(video.niche || "unknown"),
      platform: String(video.platform || "unknown"),
      status: "ready",
      reason: "direct_media_url",
      asset_url: direct,
      page_url: video.url || null,
      asset_kind: assetKind(direct),
      next_worker: "audio_visual",
      score: video.virality_score == null ? null : Number(video.virality_score),
    };
  }

  const url = asUrl(video.url);
  if (!url) {
    return {
      video_id: Number(video.id || 0) || null,
      niche: String(video.niche || "unknown"),
      platform: String(video.platform || "unknown"),
      status: "blocked",
      reason: "invalid_url",
      asset_url: null,
      page_url: null,
      asset_kind: null,
      next_worker: "skip",
      score: video.virality_score == null ? null : Number(video.virality_score),
    };
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const isSocialPage = SOCIAL_PAGE_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  if (isSocialPage) {
    return {
      video_id: Number(video.id || 0) || null,
      niche: String(video.niche || "unknown"),
      platform: String(video.platform || "unknown"),
      status: "metadata_only",
      reason: "social_page_url_no_direct_asset",
      asset_url: null,
      page_url: url.href,
      asset_kind: null,
      next_worker: "metadata_only_pattern_brain",
      score: video.virality_score == null ? null : Number(video.virality_score),
    };
  }

  return {
    video_id: Number(video.id || 0) || null,
    niche: String(video.niche || "unknown"),
    platform: String(video.platform || "unknown"),
    status: "unknown",
    reason: "unsupported_host",
    asset_url: null,
    page_url: url.href,
    asset_kind: null,
    next_worker: "manual_resolver_review",
    score: video.virality_score == null ? null : Number(video.virality_score),
  };
}

export function buildReelsMediaIntelligenceReport(videos: ReelsMediaSourceVideo[]) {
  const rows = videos.map(classifyReelsMediaAsset);
  const summary = {
    total: rows.length,
    ready: 0,
    metadata_only: 0,
    blocked: 0,
    unknown: 0,
    video_assets: 0,
    audio_assets: 0,
    by_platform: {} as Record<string, { total: number; ready: number; metadata_only: number; blocked: number; unknown: number }>,
    by_niche: {} as Record<string, { total: number; ready: number; metadata_only: number; blocked: number; unknown: number }>,
    reasons: {} as Record<string, number>,
  };

  for (const row of rows) {
    summary[row.status] += 1;
    if (row.asset_kind === "video") summary.video_assets += 1;
    if (row.asset_kind === "audio") summary.audio_assets += 1;
    summary.reasons[row.reason] = (summary.reasons[row.reason] || 0) + 1;
    for (const [bucket, key] of [[summary.by_platform, row.platform], [summary.by_niche, row.niche]] as const) {
      bucket[key] = bucket[key] || { total: 0, ready: 0, metadata_only: 0, blocked: 0, unknown: 0 };
      bucket[key].total += 1;
      bucket[key][row.status] += 1;
    }
  }

  const directAssets = rows.filter((row) => row.status === "ready");
  const videoAssets = directAssets.filter((row) => row.asset_kind === "video");
  const audioAssets = directAssets.filter((row) => row.asset_kind === "audio");
  const mediaReadyPct = summary.total ? Math.round((summary.ready / summary.total) * 100) : 0;

  return {
    ok: true,
    mode: "reels_brain_media_intelligence",
    policy: "report-only; no downloads; no paid ASR; no content-factory generation",
    summary: {
      ...summary,
      media_ready_pct: mediaReadyPct,
    },
    direct_asset_store: {
      status: directAssets.length ? "ready_for_storage" : "waiting_for_provider_assets",
      storage_mode: "report_only_no_schema_migration",
      candidates: directAssets.slice(0, 50),
      proposed_fields: ["video_id", "niche", "platform", "asset_url", "asset_kind", "source", "resolved_at", "legal_basis"],
      note: "Next DB step: create a dedicated media asset table or persist provider video_url/download_url without replacing the social page URL.",
    },
    audio_worker_mvp: {
      status: directAssets.length ? "ready_for_runtime" : "blocked_waiting_for_direct_assets",
      candidate_count: directAssets.length,
      contract: {
        input: "direct video/audio asset URL",
        output: ["duration_sec", "has_voice", "speech_start_sec", "rough_tempo_bpm", "loudness_bucket", "pause_map"],
        runtime: "Railway sidecar with FFmpeg + lightweight audio feature extractor",
      },
      sample: directAssets.slice(0, 10),
    },
    transcript_layer: {
      status: directAssets.length ? "ready_for_asr_provider" : "blocked_waiting_for_audio_assets",
      candidate_count: directAssets.length,
      contract: {
        input: "audio extracted from direct asset",
        output: ["language", "transcript", "first_phrase", "speech_speed_wps", "pause_points", "confidence"],
        runtime: "Whisper/FAL ASR only after legal/signed asset exists",
      },
      sample: [...audioAssets, ...videoAssets].slice(0, 10),
    },
    visual_worker_mvp: {
      status: videoAssets.length ? "ready_for_runtime" : "blocked_waiting_for_video_assets",
      candidate_count: videoAssets.length,
      contract: {
        input: "direct video asset URL",
        output: ["first_frame_type", "text_overlay_density", "cut_density", "camera_style", "visual_recipe_hints"],
        runtime: "Railway sidecar with FFmpeg frame sampling + vision classifier",
      },
      sample: videoAssets.slice(0, 10),
    },
    blocked: {
      metadata_only: rows.filter((row) => row.status === "metadata_only").slice(0, 20),
      unknown: rows.filter((row) => row.status === "unknown").slice(0, 20),
      blocked: rows.filter((row) => row.status === "blocked").slice(0, 20),
    },
  };
}
