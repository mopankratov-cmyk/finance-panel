import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { automationRunHistory, incidentHistory } from "@/lib/factory/reelsBrainPlaybook";

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

function createdAtMs(value: unknown): number {
  const parsed = typeof value === "string" ? new Date(value).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function bottleneckMeta(key: string, count: number, throughputPer24h: number) {
  const eta = etaHours(count, throughputPer24h);
  if (key === "media") {
    return {
      label: "media bridge",
      note: count > 0 ? "много роликов ещё не дошли до прямого media locator" : "media bridge чистый",
      eta_hours: eta,
    };
  }
  if (key === "audio") {
    return {
      label: "audio extraction",
      note: count > 0 ? "media уже есть, но звук ещё не снят или не подтверждён" : "audio extraction чистый",
      eta_hours: eta,
    };
  }
  if (key === "transcript") {
    return {
      label: "transcript layer",
      note: count > 0 ? "звук уже есть, но речь ещё не переведена в текст" : "transcript слой чистый",
      eta_hours: eta,
    };
  }
  return {
    label: "pattern analysis",
    note: count > 0 ? "контент подготовлен, но ещё не дошёл до pattern memory" : "pattern analysis чистый",
    eta_hours: eta,
  };
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
    const incidentTimeline: Array<Record<string, unknown>> = [];
    const runTimeline: Array<Record<string, unknown>> = [];
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

      for (const run of automationRunHistory(playbook).slice(0, 8)) {
        const runRecord = rec(run);
        runTimeline.push({
          niche,
          mode: text(run.mode, 60) || "run",
          created_at: text(run.created_at, 120) || null,
          inserted: num(run.inserted),
          analyzed: num(run.analyzed),
          found: num(run.found),
          errors: num(run.errors),
          providers: Array.isArray(runRecord.providers) ? runRecord.providers.slice(0, 4) : [],
          usd_per_inserted: num(runRecord.usd_per_inserted),
          usd_per_analyzed: num(runRecord.usd_per_analyzed),
        });
      }

      for (const incident of incidentHistory(playbook).slice(0, 8)) {
        incidentTimeline.push({
          niche,
          platform: text(incident.platform, 40) || "mixed",
          severity: text(incident.severity, 40) || "watch",
          kind: text(incident.kind, 80) || "incident",
          provider: text(incident.provider, 80),
          query: text(incident.query, 180),
          message: text(incident.message, 220) || "incident",
          created_at: text(incident.created_at, 120) || null,
        });
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
      total_backlog: bucket.media_backlog + bucket.audio_backlog + bucket.transcript_backlog + bucket.analyze_backlog,
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

    const bottlenecks = [
      { key: "media", count: totals.media_backlog },
      { key: "audio", count: totals.audio_backlog },
      { key: "transcript", count: totals.transcript_backlog },
      { key: "analyze", count: totals.analyze_backlog },
    ]
      .map((item) => ({ ...item, ...bottleneckMeta(item.key, item.count, analyzedLast24h) }))
      .sort((a, b) => b.count - a.count);

    const platformWatchlist = [...platforms]
      .map((platform) => {
        const dominantGap = [
          { key: "media", count: platform.media_backlog, label: "media" },
          { key: "audio", count: platform.audio_backlog, label: "audio" },
          { key: "transcript", count: platform.transcript_backlog, label: "transcript" },
          { key: "analyze", count: platform.analyze_backlog, label: "analyze" },
        ].sort((a, b) => b.count - a.count)[0];
        return {
          platform: platform.platform,
          status: platform.status,
          total_backlog: platform.total_backlog,
          dominant_gap: dominantGap,
          direct_rate: platform.direct_media_rate,
          audio_rate: platform.audio_extracted_rate,
          analyzed_rate: platform.analyzed_rate,
          eta_audio_hours: platform.automation_eta_hours.audio,
          eta_analyze_hours: platform.automation_eta_hours.analyze,
          note: dominantGap?.count
            ? `${platform.platform}: главный хвост сейчас в ${dominantGap.label}`
            : `${platform.platform}: хвостов почти не осталось`,
        };
      })
      .sort((a, b) => b.total_backlog - a.total_backlog);

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
      primary_bottleneck: bottlenecks[0] || null,
      bottlenecks,
      platform_watchlist: platformWatchlist.slice(0, 6),
      incident_timeline: incidentTimeline
        .sort((a, b) => createdAtMs(b.created_at) - createdAtMs(a.created_at))
        .slice(0, 18),
      run_timeline: runTimeline
        .sort((a, b) => createdAtMs(b.created_at) - createdAtMs(a.created_at))
        .slice(0, 12),
      platforms,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "progress reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
