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
  media_probe?: {
    ok?: boolean;
    error?: string | null;
    duration_sec?: number | null;
    size_mb?: number | null;
    format?: string | null;
    width?: number | null;
    height?: number | null;
    has_audio?: boolean;
    has_video?: boolean;
    fps?: number | null;
    video_codec?: string | null;
    audio_codec?: string | null;
    audio_channels?: number | null;
    audio_sample_rate?: number | null;
    audio_features?: {
      mean_volume_db?: number | null;
      max_volume_db?: number | null;
      loudness_bucket?: string | null;
      silence_events?: number | null;
      total_silence_sec?: number | null;
      silence_share_pct?: number | null;
      first_silence_start_sec?: number | null;
      sound_starts_immediately?: boolean;
    } | null;
    visual_features?: {
      orientation?: string | null;
      fps_bucket?: string | null;
      scene_change_count?: number | null;
      cut_density_per_10s?: number | null;
      edit_pace?: string | null;
      black_segments?: number | null;
      starts_with_black?: boolean;
    } | null;
    feature_probe?: {
      source?: string | null;
      analyzed_sec?: number | null;
      error?: string | null;
    } | null;
  } | null;
};

type MediaProbe = NonNullable<ReelsMediaAssetClassification["media_probe"]>;

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

function mediaProbe(value: unknown): ReelsMediaAssetClassification["media_probe"] {
  const probe = rec(rec(value).media_probe);
  if (!Object.keys(probe).length) return null;
  return {
    ok: probe.ok === true,
    error: probe.error == null ? null : String(probe.error),
    duration_sec: probe.duration_sec == null ? null : Number(probe.duration_sec),
    size_mb: probe.size_mb == null ? null : Number(probe.size_mb),
    format: probe.format == null ? null : String(probe.format),
    width: probe.width == null ? null : Number(probe.width),
    height: probe.height == null ? null : Number(probe.height),
    has_audio: probe.has_audio === true,
    has_video: probe.has_video === true,
    fps: probe.fps == null ? null : Number(probe.fps),
    video_codec: probe.video_codec == null ? null : String(probe.video_codec),
    audio_codec: probe.audio_codec == null ? null : String(probe.audio_codec),
    audio_channels: probe.audio_channels == null ? null : Number(probe.audio_channels),
    audio_sample_rate: probe.audio_sample_rate == null ? null : Number(probe.audio_sample_rate),
    audio_features: Object.keys(rec(probe.audio_features)).length ? rec(probe.audio_features) as MediaProbe["audio_features"] : null,
    visual_features: Object.keys(rec(probe.visual_features)).length ? rec(probe.visual_features) as MediaProbe["visual_features"] : null,
    feature_probe: Object.keys(rec(probe.feature_probe)).length ? rec(probe.feature_probe) as MediaProbe["feature_probe"] : null,
  };
}

function durationBucket(seconds: number | null | undefined): "short" | "standard" | "long" | "unknown" {
  if (!seconds || !Number.isFinite(seconds)) return "unknown";
  if (seconds <= 20) return "short";
  if (seconds <= 60) return "standard";
  return "long";
}

function increment(bucket: Record<string, number>, key: string) {
  bucket[key] = (bucket[key] || 0) + 1;
}

function share(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function buildCreativeDnaInsights(rows: ReelsMediaAssetClassification[]) {
  const probed = rows.filter((row) => row.media_probe?.ok);
  const readyVideo = rows.filter((row) => row.status === "ready" && row.asset_kind === "video");
  const byDuration: Record<string, number> = {};
  const byFps: Record<string, number> = {};
  const byFormat: Record<string, number> = {};
  const byLoudness: Record<string, number> = {};
  const byEditPace: Record<string, number> = {};
  const byNiche: Record<string, { ready: number; probed: number; vertical: number; audio: number; avg_duration_sec: number }> = {};
  let durationTotal = 0;

  for (const row of readyVideo) {
    byNiche[row.niche] = byNiche[row.niche] || { ready: 0, probed: 0, vertical: 0, audio: 0, avg_duration_sec: 0 };
    byNiche[row.niche].ready += 1;
  }

  for (const row of probed) {
    const probe = row.media_probe;
    const duration = probe?.duration_sec || 0;
    const fps = probe?.fps || 0;
    const vertical = (probe?.height || 0) > (probe?.width || 0);
    durationTotal += duration;
    increment(byDuration, durationBucket(duration));
    increment(byFps, fps >= 55 ? "55+ fps" : fps >= 28 ? "28-54 fps" : fps > 0 ? "under 28 fps" : "unknown");
    increment(byFormat, probe?.format?.split(",")[0] || "unknown");
    increment(byLoudness, probe?.audio_features?.loudness_bucket || "unknown");
    increment(byEditPace, probe?.visual_features?.edit_pace || "unknown");

    byNiche[row.niche] = byNiche[row.niche] || { ready: 0, probed: 0, vertical: 0, audio: 0, avg_duration_sec: 0 };
    byNiche[row.niche].probed += 1;
    if (vertical) byNiche[row.niche].vertical += 1;
    if (probe?.has_audio) byNiche[row.niche].audio += 1;
    byNiche[row.niche].avg_duration_sec += duration;
  }

  for (const niche of Object.keys(byNiche)) {
    const row = byNiche[niche];
    row.avg_duration_sec = row.probed ? Math.round((row.avg_duration_sec / row.probed) * 10) / 10 : 0;
  }

  const verticalCount = probed.filter((row) => (row.media_probe?.height || 0) > (row.media_probe?.width || 0)).length;
  const audioCount = probed.filter((row) => row.media_probe?.has_audio).length;
  const featureCount = probed.filter((row) => row.media_probe?.audio_features || row.media_probe?.visual_features).length;
  const immediateSoundCount = probed.filter((row) => row.media_probe?.audio_features?.sound_starts_immediately).length;
  const fastEditCount = probed.filter((row) => row.media_probe?.visual_features?.edit_pace === "fast").length;
  const shortCount = byDuration.short || 0;
  const standardCount = byDuration.standard || 0;
  const longCount = byDuration.long || 0;
  const bottleneck = readyVideo.length > probed.length
    ? "av_probe_backlog"
    : rows.some((row) => row.status === "metadata_only")
      ? "direct_asset_resolution"
      : "creative_classification";

  const insights = [
    probed.length
      ? `${share(verticalCount, probed.length)}% разобранных mp4 вертикальные: это хороший сигнал для Reels/TikTok/Shorts.`
      : "AV-слой еще не накопил успешных mp4-проб.",
    probed.length
      ? `${share(audioCount, probed.length)}% разобранных mp4 имеют аудио: их можно вести в Speech/Audio Intelligence.`
      : "Audio readiness появится после первых успешных ffprobe.",
    probed.length
      ? `По длине: short ${shortCount}, standard ${standardCount}, long ${longCount}; средняя длина ${Math.round((durationTotal / probed.length) * 10) / 10} сек.`
      : "Duration-кластеры пока пустые.",
  ];

  return {
    status: probed.length ? "learning_from_real_mp4" : readyVideo.length ? "waiting_for_av_probe" : "waiting_for_direct_assets",
    bottleneck,
    probed_videos: probed.length,
    feature_probed_videos: featureCount,
    feature_backlog_videos: Math.max(0, probed.length - featureCount),
    unprobed_ready_videos: Math.max(0, readyVideo.length - probed.length),
    vertical_share_pct: share(verticalCount, probed.length),
    audio_share_pct: share(audioCount, probed.length),
    immediate_sound_share_pct: share(immediateSoundCount, probed.length),
    fast_edit_share_pct: share(fastEditCount, probed.length),
    avg_duration_sec: probed.length ? Math.round((durationTotal / probed.length) * 10) / 10 : 0,
    duration_buckets: byDuration,
    fps_buckets: byFps,
    format_buckets: byFormat,
    loudness_buckets: byLoudness,
    edit_pace_buckets: byEditPace,
    by_niche: byNiche,
    next_actions: [
      readyVideo.length > probed.length ? `Догнать AV-probe еще ${Math.max(0, readyVideo.length - probed.length)} ready mp4.` : "AV-probe backlog закрыт для текущих ready mp4.",
      featureCount ? "На основе ffmpeg features можно ранжировать: loudness, паузы, sound start, cut density, edit pace." : "Накопить lightweight audio/visual features поверх ffprobe.",
      audioCount ? "Следующий платный/тяжелый слой: ASR первая фраза, скорость речи, паузы, наличие голоса в первые 0.5с." : "Сначала накопить mp4 с audio stream.",
      verticalCount ? "Следующий тяжелый visual слой: первый кадр, крупность товара, текст на экране, объект/товар." : "Сначала накопить вертикальные mp4.",
      "Склеить AV-сигналы с Pattern Brain: hook + duration + audio + visual recipe = Creative DNA.",
    ],
    user_insights: insights,
  };
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
      media_probe: mediaProbe(video.analyzed_full),
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
      media_probe: mediaProbe(video.analyzed_full),
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
      media_probe: mediaProbe(video.analyzed_full),
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
    media_probe: mediaProbe(video.analyzed_full),
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
    media_probed: 0,
    media_probe_ok: 0,
    media_probe_failed: 0,
    with_audio_stream: 0,
    vertical_video_assets: 0,
    avg_duration_sec: 0,
    by_platform: {} as Record<string, { total: number; ready: number; metadata_only: number; blocked: number; unknown: number }>,
    by_niche: {} as Record<string, { total: number; ready: number; metadata_only: number; blocked: number; unknown: number }>,
    reasons: {} as Record<string, number>,
  };
  let durationTotal = 0;

  for (const row of rows) {
    summary[row.status] += 1;
    if (row.asset_kind === "video") summary.video_assets += 1;
    if (row.asset_kind === "audio") summary.audio_assets += 1;
    if (row.media_probe) {
      summary.media_probed += 1;
      if (row.media_probe.ok) summary.media_probe_ok += 1;
      else summary.media_probe_failed += 1;
      if (row.media_probe.has_audio) summary.with_audio_stream += 1;
      if ((row.media_probe.height || 0) > (row.media_probe.width || 0)) summary.vertical_video_assets += 1;
      if (row.media_probe.duration_sec && Number.isFinite(row.media_probe.duration_sec)) durationTotal += row.media_probe.duration_sec;
    }
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
  summary.avg_duration_sec = summary.media_probe_ok ? Math.round(durationTotal / summary.media_probe_ok * 10) / 10 : 0;
  const creativeDnaInsights = buildCreativeDnaInsights(rows);

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
      candidates: directAssets
        .sort((a, b) =>
          Number(!!a.media_probe) - Number(!!b.media_probe)
          || Number(!!(b.media_probe?.ok && !b.media_probe?.feature_probe)) - Number(!!(a.media_probe?.ok && !a.media_probe?.feature_probe))
          || Number(!!a.media_probe?.ok) - Number(!!b.media_probe?.ok)
          || Number(b.score || 0) - Number(a.score || 0)
        )
        .slice(0, 50),
      proposed_fields: ["video_id", "niche", "platform", "asset_url", "asset_kind", "source", "resolved_at", "legal_basis"],
      note: "Next DB step: create a dedicated media asset table or persist provider video_url/download_url without replacing the social page URL.",
    },
    creative_dna_insights: creativeDnaInsights,
    audio_worker_mvp: {
      status: directAssets.length ? "ready_for_runtime" : "blocked_waiting_for_direct_assets",
      candidate_count: directAssets.length,
      probed_count: summary.media_probe_ok,
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
      probed_count: summary.media_probe_ok,
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
      probed_count: summary.media_probe_ok,
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
