import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { automationRunHistory } from "@/lib/factory/reelsBrainPlaybook";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

type CorpusRow = {
  niche?: string | null;
  platform?: string | null;
  analyzed?: boolean | null;
  analyzed_full?: unknown;
};

type PlaybookRow = {
  niche?: string | null;
  updated_at?: string | null;
  playbook?: unknown;
};

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const out = value.trim();
  return out ? out.slice(0, max) : null;
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

function directVideoLocator(value: string) {
  const target = value.trim().toLowerCase();
  if (!target) return false;
  if (/\.(jpg|jpeg|png|webp|gif|bmp|heic|heif|avif)(\?|$)/i.test(target)) return false;
  if (/\.(mp4|m4v|mov|webm|m3u8)(\?|$)/i.test(target)) return true;
  if (/mime_type=video_|video_mp4|\/video\/|\/videoplayback\b|\.googlevideo\.com\//i.test(target)) return true;
  return false;
}

function seedState(row: CorpusRow) {
  const analyzedFull = rec(row.analyzed_full);
  const reelsSeed = rec(analyzedFull.reels_seed);
  const pipeline = rec(reelsSeed.pipeline);
  const mediaLocators = Array.isArray(reelsSeed.media_locator_candidates)
    ? reelsSeed.media_locator_candidates.filter((item) => typeof item === "string" && item.trim())
    : [];
  const directMediaLocators = mediaLocators.filter((item) => directVideoLocator(String(item)));
  return {
    mediaLocators,
    directMediaLocators,
    mediaStatus: text(pipeline.media_status, 60) || "media_missing",
    audioStatus: text(pipeline.audio_status, 60) || "audio_pending",
    transcriptStatus: text(pipeline.transcript_status, 60) || "transcript_pending",
  };
}

function dayAgo(hours: number) {
  return Date.now() - hours * 60 * 60 * 1000;
}

function etaHours(backlog: number, throughputPer24h: number) {
  if (backlog <= 0) return 0;
  if (throughputPer24h <= 0) return null;
  return Math.round((backlog / throughputPer24h) * 24 * 10) / 10;
}

export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: true, warning: "Supabase не настроен", totals: null, platforms: [] }, { headers: { "Cache-Control": "no-store" } });

    const niches = Array.from(new Set(String(req.nextUrl.searchParams.get("niches") || "ru_toys,ru_clothing,ru_cosmetics")
      .split(",")
      .map((row) => row.trim())
      .filter(Boolean)));

    const [{ data: corpus, error: corpusError }, { data: playbooks, error: playbookError }] = await Promise.all([
      db.from("viral_videos")
        .select("niche,platform,analyzed,analyzed_full")
        .in("niche", niches)
        .limit(10000),
      db.from("niche_playbooks")
        .select("niche,updated_at,playbook")
        .in("niche", niches)
        .order("updated_at", { ascending: false }),
    ]);
    if (corpusError) return NextResponse.json({ error: corpusError.message }, { status: 500 });
    if (playbookError) return NextResponse.json({ error: playbookError.message }, { status: 500 });

    const latestPlaybookByNiche = new Map<string, PlaybookRow>();
    for (const row of ((playbooks || []) as PlaybookRow[])) {
      const niche = String(row.niche || "").trim();
      if (!niche || latestPlaybookByNiche.has(niche)) continue;
      latestPlaybookByNiche.set(niche, row);
    }

    const rows = ((corpus || []) as CorpusRow[]);
    const buckets = new Map<string, {
      total: number;
      with_media_candidates: number;
      with_direct_media: number;
      media_downloaded: number;
      audio_extracted: number;
      transcript_ready: number;
      analyzed: number;
      media_backlog: number;
      audio_backlog: number;
      transcript_backlog: number;
      analyze_backlog: number;
      patterns: number;
      generator_ready_patterns: number;
    }>();

    for (const platform of ["tiktok", "instagram", "youtube"]) {
      buckets.set(platform, {
        total: 0,
        with_media_candidates: 0,
        with_direct_media: 0,
        media_downloaded: 0,
        audio_extracted: 0,
        transcript_ready: 0,
        analyzed: 0,
        media_backlog: 0,
        audio_backlog: 0,
        transcript_backlog: 0,
        analyze_backlog: 0,
        patterns: 0,
        generator_ready_patterns: 0,
      });
    }

    for (const row of rows) {
      const platform = String(row.platform || "unknown").trim().toLowerCase();
      if (!buckets.has(platform)) continue;
      const bucket = buckets.get(platform)!;
      const seed = seedState(row);
      bucket.total += 1;
      if (seed.mediaLocators.length) bucket.with_media_candidates += 1;
      if (seed.directMediaLocators.length) bucket.with_direct_media += 1;
      if (seed.mediaStatus === "media_downloaded") bucket.media_downloaded += 1;
      if (seed.audioStatus === "audio_extracted") bucket.audio_extracted += 1;
      if (seed.transcriptStatus === "transcript_ready") bucket.transcript_ready += 1;
      if (row.analyzed) bucket.analyzed += 1;

      const mediaReady = seed.directMediaLocators.length > 0 || seed.mediaStatus === "media_downloaded";
      if (!mediaReady) bucket.media_backlog += 1;
      if (mediaReady && seed.audioStatus !== "audio_extracted") bucket.audio_backlog += 1;
      if (seed.audioStatus === "audio_extracted" && seed.transcriptStatus !== "transcript_ready") bucket.transcript_backlog += 1;
      if (!row.analyzed) bucket.analyze_backlog += 1;
    }

    let analyzedLast24h = 0;
    let insertedLast24h = 0;
    for (const niche of niches) {
      const playbook = latestPlaybookByNiche.get(niche)?.playbook;
      const runs = automationRunHistory(playbook).filter((run) => {
        const createdAt = text(run.created_at, 120);
        const time = createdAt ? new Date(createdAt).getTime() : NaN;
        return Number.isFinite(time) && time >= dayAgo(24);
      });
      for (const run of runs) {
        analyzedLast24h += num(run.analyzed);
        insertedLast24h += num(run.inserted);
      }

      const bundle = rec(rec(playbook).reels_brain_patterns);
      const platformBrains = rec(bundle.platform_brains);
      for (const platform of ["tiktok", "instagram", "youtube"]) {
        const bucket = buckets.get(platform);
        if (!bucket) continue;
        const brain = rec(platformBrains[platform]);
        bucket.patterns += Array.isArray(brain.patterns) ? brain.patterns.length : 0;
        bucket.generator_ready_patterns += Array.isArray(brain.generator_ready_patterns) ? brain.generator_ready_patterns.length : 0;
      }
    }

    const platforms = Array.from(buckets.entries()).map(([platform, bucket]) => ({
      platform,
      ...bucket,
      media_candidate_rate: pct(bucket.with_media_candidates, bucket.total),
      direct_media_rate: pct(bucket.with_direct_media, bucket.total),
      media_downloaded_rate: pct(bucket.media_downloaded, bucket.total),
      audio_extracted_rate: pct(bucket.audio_extracted, bucket.total),
      transcript_ready_rate: pct(bucket.transcript_ready, bucket.total),
      analyzed_rate: pct(bucket.analyzed, bucket.total),
      automation_eta_hours: {
        audio: etaHours(bucket.audio_backlog, analyzedLast24h),
        analyze: etaHours(bucket.analyze_backlog, analyzedLast24h),
      },
      status:
        bucket.total === 0 ? "empty"
          : bucket.media_backlog > 0 ? "media_backlog"
            : bucket.audio_backlog > 0 ? "audio_backlog"
              : bucket.analyze_backlog > 0 ? "analyze_backlog"
                : "healthy",
    }));

    const totals = platforms.reduce((acc, platform) => ({
      total: acc.total + platform.total,
      with_media_candidates: acc.with_media_candidates + platform.with_media_candidates,
      with_direct_media: acc.with_direct_media + platform.with_direct_media,
      media_downloaded: acc.media_downloaded + platform.media_downloaded,
      audio_extracted: acc.audio_extracted + platform.audio_extracted,
      transcript_ready: acc.transcript_ready + platform.transcript_ready,
      analyzed: acc.analyzed + platform.analyzed,
      media_backlog: acc.media_backlog + platform.media_backlog,
      audio_backlog: acc.audio_backlog + platform.audio_backlog,
      transcript_backlog: acc.transcript_backlog + platform.transcript_backlog,
      analyze_backlog: acc.analyze_backlog + platform.analyze_backlog,
      patterns: acc.patterns + platform.patterns,
      generator_ready_patterns: acc.generator_ready_patterns + platform.generator_ready_patterns,
    }), {
      total: 0,
      with_media_candidates: 0,
      with_direct_media: 0,
      media_downloaded: 0,
      audio_extracted: 0,
      transcript_ready: 0,
      analyzed: 0,
      media_backlog: 0,
      audio_backlog: 0,
      transcript_backlog: 0,
      analyze_backlog: 0,
      patterns: 0,
      generator_ready_patterns: 0,
    });

    return NextResponse.json({
      ok: true,
      niches,
      throughput_24h: {
        analyzed: analyzedLast24h,
        inserted: insertedLast24h,
      },
      totals: {
        ...totals,
        media_candidate_rate: pct(totals.with_media_candidates, totals.total),
        direct_media_rate: pct(totals.with_direct_media, totals.total),
        media_downloaded_rate: pct(totals.media_downloaded, totals.total),
        audio_extracted_rate: pct(totals.audio_extracted, totals.total),
        transcript_ready_rate: pct(totals.transcript_ready, totals.total),
        analyzed_rate: pct(totals.analyzed, totals.total),
        eta_hours: {
          audio: etaHours(totals.audio_backlog, analyzedLast24h),
          analyze: etaHours(totals.analyze_backlog, analyzedLast24h),
        },
      },
      platforms,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "progress reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
