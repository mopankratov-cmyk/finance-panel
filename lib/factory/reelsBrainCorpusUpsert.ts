import type { NormalizedReelsVideo, ViralVideoInsertRow } from "./reelsBrain";

type ExistingCorpusRow = {
  id: number;
  url: string;
  niche?: string | null;
  platform?: string | null;
  views?: number | null;
  likes?: number | null;
  followers_creator?: number | null;
  virality_score?: number | null;
  caption?: string | null;
  sound_id?: string | null;
  sound_title?: string | null;
  source_orbit_id?: string | null;
  analyzed_full?: unknown;
};

type SeedMetadata = {
  seed_version: 1;
  source_provider: string;
  source_query: string | null;
  source_type: string | null;
  canonical_url: string;
  external_url: string;
  media_locator_candidates: string[];
  transcript: string | null;
  author: string | null;
  duration_sec: number | null;
  hashtags: string[];
  sound_id: string | null;
  sound_title: string | null;
  published_at: string | null;
  last_seen_at: string;
  pipeline: {
    media_status: "media_missing" | "media_found" | "media_downloaded";
    audio_status: "audio_pending" | "audio_extracted" | "audio_failed";
    transcript_status: "transcript_pending" | "transcript_ready" | "transcript_failed";
    last_error: string | null;
    media_checked_at: string | null;
    audio_checked_at: string | null;
    transcript_checked_at: string | null;
    attempts: {
      media: number;
      audio: number;
      transcript: number;
    };
  };
  audio_source_url: string | null;
  audio_features: Record<string, unknown> | null;
};

function num(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown, max = 4000): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function uniqStrings(values: unknown[], max = 24): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const cleaned = text(value, 1200);
    if (!cleaned) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
    if (out.length >= max) break;
  }
  return out;
}

function bestText(current: unknown, incoming: unknown): string | null {
  const a = text(current);
  const b = text(incoming);
  if (!a) return b;
  if (!b) return a;
  return b.length > a.length ? b : a;
}

function maxNumber(current: unknown, incoming: unknown): number | null {
  const a = num(current);
  const b = num(incoming);
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function shouldKeepPageLocator(input: { platform?: string; url?: string | null }) {
  const platform = String(input.platform || "").trim().toLowerCase();
  const url = text(input.url, 1500) || "";
  if (platform === "youtube" && /(youtube\.com\/shorts\/|youtube\.com\/watch\?|youtu\.be\/)/i.test(url)) return true;
  if (platform === "instagram" && /(instagram\.com|instagr\.am)\/(reel|reels|tv|p)\//i.test(url)) return true;
  return false;
}

export function buildReelsSeedMetadata(input: {
  video: NormalizedReelsVideo;
  sourceProvider: string;
  sourceQuery?: string;
  sourceType?: string;
  now?: string;
}): SeedMetadata {
  const now = input.now || new Date().toISOString();
  const mediaLocatorCandidates = uniqStrings([
    input.video.mediaUrl,
    input.video.url !== input.video.canonicalUrl || shouldKeepPageLocator({ platform: input.video.platform, url: input.video.url })
      ? input.video.url
      : null,
  ]);
  return {
    seed_version: 1,
    source_provider: text(input.sourceProvider, 120) || "unknown",
    source_query: text(input.sourceQuery, 400),
    source_type: text(input.sourceType, 80),
    canonical_url: input.video.canonicalUrl,
    external_url: input.video.url,
    media_locator_candidates: mediaLocatorCandidates,
    transcript: text(input.video.transcript, 6000),
    author: text(input.video.author, 240),
    duration_sec: num(input.video.durationSec),
    hashtags: uniqStrings(input.video.hashtags || [], 30),
    sound_id: text(input.video.soundId, 240),
    sound_title: text(input.video.soundTitle, 500),
    published_at: text(input.video.publishedAt, 120),
    last_seen_at: now,
    pipeline: {
      media_status: mediaLocatorCandidates.length ? "media_found" : "media_missing",
      audio_status: "audio_pending",
      transcript_status: input.video.transcript ? "transcript_ready" : "transcript_pending",
      last_error: null,
      media_checked_at: now,
      audio_checked_at: null,
      transcript_checked_at: input.video.transcript ? now : null,
      attempts: {
        media: mediaLocatorCandidates.length ? 1 : 0,
        audio: 0,
        transcript: input.video.transcript ? 1 : 0,
      },
    },
    audio_source_url: text(input.video.mediaUrl, 1500),
    audio_features: null,
  };
}

export function mergeAnalyzedFullWithReelsSeed(existing: unknown, seed: SeedMetadata | null | undefined) {
  const current = rec(existing);
  if (!seed) return current;
  const currentSeed = rec(current.reels_seed);
  return {
    ...current,
    reels_seed: {
      ...currentSeed,
      seed_version: 1,
      source_provider: seed.source_provider || text(currentSeed.source_provider, 120) || "unknown",
      source_query: seed.source_query || text(currentSeed.source_query, 400),
      source_type: seed.source_type || text(currentSeed.source_type, 80),
      canonical_url: seed.canonical_url || text(currentSeed.canonical_url, 1200) || "",
      external_url: seed.external_url || text(currentSeed.external_url, 1200) || "",
      media_locator_candidates: uniqStrings([
        ...(Array.isArray(currentSeed.media_locator_candidates) ? currentSeed.media_locator_candidates : []),
        ...seed.media_locator_candidates,
      ], 30),
      transcript: text(currentSeed.transcript, 6000) || seed.transcript,
      author: text(currentSeed.author, 240) || seed.author,
      duration_sec: num(currentSeed.duration_sec) ?? seed.duration_sec,
      hashtags: uniqStrings([
        ...(Array.isArray(currentSeed.hashtags) ? currentSeed.hashtags : []),
        ...seed.hashtags,
      ], 30),
      sound_id: text(currentSeed.sound_id, 240) || seed.sound_id,
      sound_title: text(currentSeed.sound_title, 500) || seed.sound_title,
      published_at: text(currentSeed.published_at, 120) || seed.published_at,
      last_seen_at: seed.last_seen_at,
      pipeline: {
        media_status: (() => {
          const currentStatus = text(rec(currentSeed.pipeline).media_status, 60);
          if (currentStatus === "media_downloaded") return "media_downloaded";
          return seed.media_locator_candidates.length ? "media_found" : currentStatus || "media_missing";
        })(),
        audio_status: text(rec(currentSeed.pipeline).audio_status, 60) || "audio_pending",
        transcript_status: (() => {
          const currentStatus = text(rec(currentSeed.pipeline).transcript_status, 60);
          if (currentStatus === "transcript_ready") return "transcript_ready";
          return seed.transcript ? "transcript_ready" : currentStatus || "transcript_pending";
        })(),
        last_error: text(rec(currentSeed.pipeline).last_error, 240),
        media_checked_at: seed.last_seen_at,
        audio_checked_at: text(rec(currentSeed.pipeline).audio_checked_at, 120),
        transcript_checked_at: seed.transcript ? seed.last_seen_at : text(rec(currentSeed.pipeline).transcript_checked_at, 120),
        attempts: {
          media: Math.max(1, num(rec(rec(currentSeed.pipeline).attempts).media) ?? 0, seed.media_locator_candidates.length ? 1 : 0),
          audio: num(rec(rec(currentSeed.pipeline).attempts).audio) ?? 0,
          transcript: Math.max(num(rec(rec(currentSeed.pipeline).attempts).transcript) ?? 0, seed.transcript ? 1 : 0),
        },
      },
      audio_source_url: text(currentSeed.audio_source_url, 1500) || seed.audio_source_url,
      audio_features: rec(currentSeed.audio_features),
    },
  };
}

export function mergeAnalyzedFullWithAudioExtraction(
  existing: unknown,
  input: {
    mediaUrl: string;
    mediaStatus: "media_downloaded" | "audio_failed";
    audioStatus: "audio_extracted" | "audio_failed";
    transcriptStatus: "transcript_ready" | "transcript_failed" | "transcript_pending";
    transcript?: string | null;
    audioFeatures?: Record<string, unknown> | null;
    error?: string | null;
    now?: string;
  },
) {
  const current = rec(existing);
  const currentSeed = rec(current.reels_seed);
  const currentPipeline = rec(currentSeed.pipeline);
  const currentAttempts = rec(currentPipeline.attempts);
  const now = input.now || new Date().toISOString();

  return {
    ...current,
    reels_seed: {
      ...currentSeed,
      media_locator_candidates: uniqStrings([
        ...(Array.isArray(currentSeed.media_locator_candidates) ? currentSeed.media_locator_candidates : []),
        input.mediaUrl,
      ], 30),
      transcript: input.transcript ? text(input.transcript, 6000) : text(currentSeed.transcript, 6000),
      audio_source_url: text(currentSeed.audio_source_url, 1500) || text(input.mediaUrl, 1500),
      audio_features: input.audioFeatures && typeof input.audioFeatures === "object"
        ? { ...(rec(currentSeed.audio_features)), ...input.audioFeatures }
        : rec(currentSeed.audio_features),
      pipeline: {
        media_status: input.mediaStatus,
        audio_status: input.audioStatus,
        transcript_status: input.transcriptStatus,
        last_error: text(input.error, 240),
        media_checked_at: now,
        audio_checked_at: now,
        transcript_checked_at: input.transcriptStatus !== "transcript_pending" ? now : text(currentPipeline.transcript_checked_at, 120),
        attempts: {
          media: (num(currentAttempts.media) ?? 0) + 1,
          audio: (num(currentAttempts.audio) ?? 0) + 1,
          transcript: input.transcriptStatus !== "transcript_pending"
            ? (num(currentAttempts.transcript) ?? 0) + 1
            : (num(currentAttempts.transcript) ?? 0),
        },
      },
    },
  };
}

export async function safeUpsertReelsCorpusRows(input: {
  db: any;
  rows: ViralVideoInsertRow[];
  normalized: NormalizedReelsVideo[];
  sourceProvider: string;
  sourceQuery?: string;
  sourceType?: string;
}) {
  const now = new Date().toISOString();
  const seedByUrl = new Map<string, SeedMetadata>();
  for (const video of input.normalized) {
    seedByUrl.set(video.canonicalUrl, buildReelsSeedMetadata({
      video,
      sourceProvider: input.sourceProvider,
      sourceQuery: input.sourceQuery,
      sourceType: input.sourceType,
      now,
    }));
  }

  const urls = Array.from(new Set(input.rows.map((row) => row.url).filter(Boolean)));
  if (!urls.length) return { inserted: 0, enriched: 0, total: 0 };

  const { data, error } = await input.db
    .from("viral_videos")
    .select("id,url,niche,platform,views,likes,followers_creator,virality_score,caption,sound_id,sound_title,source_orbit_id,analyzed_full")
    .in("url", urls);
  if (error) throw new Error(error.message);

  const existingByUrl = new Map<string, ExistingCorpusRow>();
  for (const row of (data || []) as ExistingCorpusRow[]) existingByUrl.set(row.url, row);

  const freshRows: Array<{ row: Record<string, unknown>; seed: SeedMetadata | undefined; url: string }> = [];
  const updates: Array<{ id: number; payload: Record<string, unknown> }> = [];

  for (const row of input.rows) {
    const existing = existingByUrl.get(row.url);
    const seed = seedByUrl.get(row.url);
    if (!existing) {
      freshRows.push({
        url: row.url,
        seed,
        row: {
          ...row,
          analyzed_full: mergeAnalyzedFullWithReelsSeed(null, seed),
          updated_at: now,
        },
      });
      continue;
    }

    updates.push({
      id: existing.id,
      payload: {
        niche: text(existing.niche, 120) || row.niche,
        platform: text(existing.platform, 40) || row.platform,
        views: maxNumber(existing.views, row.views),
        likes: maxNumber(existing.likes, row.likes),
        followers_creator: maxNumber(existing.followers_creator, row.followers_creator),
        virality_score: maxNumber(existing.virality_score, row.virality_score),
        caption: bestText(existing.caption, row.caption),
        sound_id: text(existing.sound_id, 240) || row.sound_id,
        sound_title: bestText(existing.sound_title, row.sound_title),
        source_orbit_id: text(existing.source_orbit_id, 240) || row.source_orbit_id,
        analyzed_full: mergeAnalyzedFullWithReelsSeed(existing.analyzed_full, seed),
        updated_at: now,
      },
    });
  }

  let inserted = 0;
  let enriched = 0;
  if (freshRows.length) {
    for (const fresh of freshRows) {
      const { count, error: insertError } = await input.db
        .from("viral_videos")
        .insert([fresh.row], { count: "exact" });
      if (!insertError) {
        inserted += count ?? 1;
        continue;
      }
      if (!/duplicate key value violates unique constraint/i.test(insertError.message || "")) {
        throw new Error(insertError.message);
      }
      const { data: dupeData, error: dupeError } = await input.db
        .from("viral_videos")
        .select("id,url,niche,platform,views,likes,followers_creator,virality_score,caption,sound_id,sound_title,source_orbit_id,analyzed_full")
        .in("url", [fresh.url]);
      if (dupeError) throw new Error(dupeError.message);
      const duplicate = ((dupeData || []) as ExistingCorpusRow[])[0];
      if (!duplicate?.id) continue;
      const payload = {
        niche: text(duplicate.niche, 120) || text(fresh.row.niche, 120),
        platform: text(duplicate.platform, 40) || text(fresh.row.platform, 40),
        views: maxNumber(duplicate.views, fresh.row.views),
        likes: maxNumber(duplicate.likes, fresh.row.likes),
        followers_creator: maxNumber(duplicate.followers_creator, fresh.row.followers_creator),
        virality_score: maxNumber(duplicate.virality_score, fresh.row.virality_score),
        caption: bestText(duplicate.caption, fresh.row.caption),
        sound_id: text(duplicate.sound_id, 240) || text(fresh.row.sound_id, 240),
        sound_title: bestText(duplicate.sound_title, fresh.row.sound_title),
        source_orbit_id: text(duplicate.source_orbit_id, 240) || text(fresh.row.source_orbit_id, 240),
        analyzed_full: mergeAnalyzedFullWithReelsSeed(duplicate.analyzed_full, fresh.seed),
        updated_at: now,
      };
      const { error: dupeUpdateError } = await input.db
        .from("viral_videos")
        .update(payload)
        .eq("id", duplicate.id);
      if (dupeUpdateError) throw new Error(dupeUpdateError.message);
      enriched += 1;
    }
  }

  for (const update of updates) {
    const { error: updateError } = await input.db
      .from("viral_videos")
      .update(update.payload)
      .eq("id", update.id);
    if (updateError) throw new Error(updateError.message);
    enriched += 1;
  }

  return {
    inserted,
    enriched,
    total: inserted + enriched,
  };
}
