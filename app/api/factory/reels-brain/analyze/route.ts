import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { fallbackVirloAnalysis, hasUsableVirloAnalysis, virloAnalyzeVideo } from "@/lib/factory/trendSources";
import { nicheFromArticle } from "@/lib/factory/rubric";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SUPABASE_PAGE_SIZE = 1000;
const MAX_ANALYZE_SCAN_ROWS = 50000;

type VideoForAnalysis = {
  id: number;
  url: string;
  niche: string | null;
  virality_score: number | null;
  caption: string | null;
  platform?: string | null;
  analyzed?: boolean | null;
};

async function markVideoAnalyzedFailure(
  db: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  video: VideoForAnalysis,
  reason: string,
) {
  const failurePayload = {
    analyzed: true,
    analyzed_full: {
      ok: false,
      error: reason,
      source: "reels-brain-analyze",
      url: video.url,
      caption: video.caption || null,
    },
    updated_at: new Date().toISOString(),
  };
  const { error } = await db.from("viral_videos").update(failurePayload).eq("id", video.id);
  return error;
}

async function loadAnalysisCandidates(
  db: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  input: { niche: string; platform: string; limit: number },
) {
  const targetNiche = input.niche.trim();
  const targetPlatform = input.platform === "tiktok" || input.platform === "instagram" || input.platform === "youtube"
    ? input.platform
    : "";
  const candidates: VideoForAnalysis[] = [];
  for (let from = 0; from < MAX_ANALYZE_SCAN_ROWS; from += SUPABASE_PAGE_SIZE) {
    const to = Math.min(from + SUPABASE_PAGE_SIZE - 1, MAX_ANALYZE_SCAN_ROWS - 1);
    let q = db
      .from("viral_videos")
      .select("id,url,niche,virality_score,caption,platform,analyzed")
      .order("virality_score", { ascending: false, nullsFirst: false })
      .range(from, to);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const page = (data || []) as VideoForAnalysis[];
    candidates.push(...page
      .filter((video) => video.analyzed !== true)
      .filter((video) => !targetNiche || String(video.niche || "").trim() === targetNiche)
      .filter((video) => !targetPlatform || String(video.platform || "").trim().toLowerCase() === targetPlatform));
    if (candidates.length >= input.limit || page.length < SUPABASE_PAGE_SIZE) break;
  }
  return candidates.slice(0, input.limit);
}

// POST { niche?, limit?, dry_run? }
// Deep-enrich top unanalysed videos through Virlo analyze_video and seed viral_hooks.
export async function POST(req: NextRequest) {
  try {
    if (!process.env.VIRLO_API_KEY) return NextResponse.json({ error: "VIRLO_API_KEY не настроен: deep analyze недоступен" }, { status: 503 });
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
    const body = await req.json().catch(() => ({}));
    const niche = String(body.niche || "").trim();
    const platform = String(body.platform || "").trim().toLowerCase();
    const limit = Math.min(25, Math.max(1, Number(body.limit || 10)));
    const dryRun = body.dry_run === true;

    const videos = await loadAnalysisCandidates(db, { niche, platform, limit });
    const results: {
      id: number;
      url: string;
      ok: boolean;
      hook?: string;
      format?: string;
      error?: string;
    }[] = [];

    for (const video of videos) {
      try {
        if (dryRun) {
          results.push({ id: video.id, url: video.url, ok: true });
          continue;
        }
        const analysis = await virloAnalyzeVideo(video.url);
        const resolvedAnalysis = hasUsableVirloAnalysis(analysis) ? analysis : fallbackVirloAnalysis(video);
        if (!resolvedAnalysis) {
          await markVideoAnalyzedFailure(db, video, "empty analysis");
          results.push({ id: video.id, url: video.url, ok: false, error: "empty analysis" });
          continue;
        }
        const update = {
          analyzed: true,
          hook_text: resolvedAnalysis.hook_text || null,
          format_detected: resolvedAnalysis.format_detected || null,
          beat_structure: resolvedAnalysis.beat_structure || null,
          viral_reason: resolvedAnalysis.viral_reason || null,
          is_commerce_safe: typeof resolvedAnalysis.is_commerce_safe === "boolean" ? resolvedAnalysis.is_commerce_safe : true,
          analyzed_full: resolvedAnalysis,
          updated_at: new Date().toISOString(),
        };
        const { error: updateErr } = await db.from("viral_videos").update(update).eq("id", video.id);
        if (updateErr) {
          results.push({ id: video.id, url: video.url, ok: false, error: updateErr.message });
          continue;
        }

        if (resolvedAnalysis.hook_text) {
          const hookNiche = video.niche || niche || nicheFromArticle("", "");
          try {
            await db.from("viral_hooks").upsert(
              {
                niche: hookNiche,
                hook_text: resolvedAnalysis.hook_text,
                video_source_id: video.id,
                structure: {
                  format: resolvedAnalysis.format_detected || null,
                  retention: resolvedAnalysis.viral_reason || null,
                },
                viability_score: 2,
                effectiveness_notes: "from reels-brain analyze",
              },
              { onConflict: "niche,hook_text", ignoreDuplicates: true },
            );
            } catch {
            try {
              const { count } = await db.from("viral_hooks").select("id", { count: "exact", head: true }).eq("niche", hookNiche).eq("hook_text", resolvedAnalysis.hook_text);
              if (!count) await db.from("viral_hooks").insert({ niche: hookNiche, hook_text: resolvedAnalysis.hook_text, video_source_id: video.id, viability_score: 2, effectiveness_notes: "from reels-brain analyze" });
            } catch { /* viral_hooks may be absent; corpus enrichment still succeeded */ }
          }
        }
        results.push({ id: video.id, url: video.url, ok: true, hook: resolvedAnalysis.hook_text, format: resolvedAnalysis.format_detected });
      } catch (e) {
        const message = String((e as Error)?.message || e).slice(0, 120);
        await markVideoAnalyzedFailure(db, video, message);
        results.push({ id: video.id, url: video.url, ok: false, error: message });
      }
    }

    return NextResponse.json({
      ok: true,
      niche: niche || null,
      platform: platform || null,
      dry_run: dryRun,
      selected: videos.length,
      analyzed: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "analyze reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
