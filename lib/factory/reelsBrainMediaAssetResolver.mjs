const DIRECT_MEDIA_EXTENSIONS = /\.(mp4|mov|m4v|webm|mp3|wav|m4a|aac)(\?|#|$)/i;
const SOCIAL_PAGE_HOSTS = [
  "tiktok.com",
  "instagram.com",
  "youtu.be",
  "youtube.com",
  "youtube-nocookie.com",
];

function asUrl(value) {
  try {
    return new URL(String(value || ""));
  } catch {
    return null;
  }
}

function isSocialPageUrl(value) {
  const url = asUrl(value);
  if (!url) return false;
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  return SOCIAL_PAGE_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function collectCandidateUrls(value, depth = 0) {
  if (!value || depth > 4) return [];
  if (typeof value === "string") return /^https?:\/\//i.test(value.trim()) ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap((item) => collectCandidateUrls(item, depth + 1)).slice(0, 50);
  if (typeof value !== "object") return [];

  const out = [];
  for (const [key, child] of Object.entries(value)) {
    if (/video|download|media|play|audio|url|src|asset/.test(key.toLowerCase())) {
      out.push(...collectCandidateUrls(child, depth + 1));
    }
  }
  return Array.from(new Set(out)).slice(0, 50);
}

function directAssetCandidate(video) {
  const fields = [video?.video_url, video?.download_url, video?.media_url, video?.audio_url, video?.url]
    .map((row) => String(row || "").trim())
    .filter(Boolean);
  const directField = fields.slice(0, 4).find((candidate) => /^https?:\/\//i.test(candidate) && !isSocialPageUrl(candidate));
  if (directField) return directField;
  return [...fields, ...collectCandidateUrls(video?.analyzed_full)]
    .find((candidate) => DIRECT_MEDIA_EXTENSIONS.test(candidate)) || null;
}

export function classifyReelsMediaAsset(video) {
  const direct = directAssetCandidate(video);
  if (direct) {
    return {
      video_id: video?.id ?? null,
      platform: video?.platform || "unknown",
      status: "ready",
      reason: "direct_media_url",
      asset_url: direct,
      page_url: video?.url || null,
      next_worker: "audio_visual",
    };
  }

  const url = asUrl(video?.url);
  if (!url) {
    return {
      video_id: video?.id ?? null,
      platform: video?.platform || "unknown",
      status: "blocked",
      reason: "invalid_url",
      asset_url: null,
      next_worker: "skip",
    };
  }

  const href = url.href;
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const isDirectMedia = DIRECT_MEDIA_EXTENSIONS.test(url.pathname) || DIRECT_MEDIA_EXTENSIONS.test(href);
  if (isDirectMedia) {
    return {
      video_id: video?.id ?? null,
      platform: video?.platform || "unknown",
      status: "ready",
      reason: "direct_media_url",
      asset_url: href,
      next_worker: "audio_visual",
    };
  }

  const isSocialPage = SOCIAL_PAGE_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  if (isSocialPage) {
    return {
      video_id: video?.id ?? null,
      platform: video?.platform || "unknown",
      status: "metadata_only",
      reason: "social_page_url_no_direct_asset",
      asset_url: null,
      page_url: href,
      next_worker: "metadata_only_pattern_brain",
    };
  }

  return {
    video_id: video?.id ?? null,
    platform: video?.platform || "unknown",
    status: "unknown",
    reason: "unsupported_host",
    asset_url: null,
    page_url: href,
    next_worker: "manual_resolver_review",
  };
}

export function summarizeReelsMediaAssets(videos) {
  const rows = Array.isArray(videos) ? videos.map(classifyReelsMediaAsset) : [];
  const summary = {
    total: rows.length,
    ready: 0,
    metadata_only: 0,
    blocked: 0,
    unknown: 0,
    by_platform: {},
    reasons: {},
  };

  for (const row of rows) {
    const status = row.status in summary ? row.status : "unknown";
    summary[status] += 1;
    const platform = String(row.platform || "unknown");
    summary.by_platform[platform] = summary.by_platform[platform] || { total: 0, ready: 0, metadata_only: 0, blocked: 0, unknown: 0 };
    summary.by_platform[platform].total += 1;
    summary.by_platform[platform][status] += 1;
    summary.reasons[row.reason] = (summary.reasons[row.reason] || 0) + 1;
  }

  return {
    ok: true,
    mode: "media_asset_resolver",
    policy: "classify only; no download; no provider calls; no paid media extraction",
    summary,
    sample: rows.slice(0, 20),
    next_runtime: {
      ready: "send direct assets to FFmpeg/Whisper/visual workers",
      metadata_only: "keep in Pattern Brain until a legal/signed media URL exists",
      unknown: "review resolver support or provider output fields",
    },
  };
}
