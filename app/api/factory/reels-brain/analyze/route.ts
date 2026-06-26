import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { virloAnalyzeVideo } from "@/lib/factory/trendSources";
import { nicheFromArticle } from "@/lib/factory/rubric";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type VideoForAnalysis = {
  id: number;
  url: string;
  niche: string | null;
  virality_score: number | null;
  caption: string | null;
};

// POST { niche?, limit?, dry_run? }
// Deep-enrich top unanalysed videos through Virlo analyze_video and seed viral_hooks.
export async function POST(req: NextRequest) {
  try {
    if (!process.env.VIRLO_API_KEY) return NextResponse.json({ error: "VIRLO_API_KEY не настроен: deep analyze недоступен" }, { status: 503 });
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
    const body = await req.json().catch(() => ({}));
    const niche = String(body.niche || "").trim();
    const limit = Math.min(25, Math.max(1, Number(body.limit || 10)));
    const dryRun = body.dry_run === true;

    let q = db
      .from("viral_videos")
      .select("id,url,niche,virality_score,caption")
      .eq("analyzed", false)
      .order("virality_score", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (niche) q = q.eq("niche", niche);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: "viral_videos: " + error.message }, { status: 500 });
    const videos = ((data || []) as VideoForAnalysis[]);
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
        if (!analysis) {
          results.push({ id: video.id, url: video.url, ok: false, error: "empty analysis" });
          continue;
        }
        const update = {
          analyzed: true,
          hook_text: analysis.hook_text || null,
          format_detected: analysis.format_detected || null,
          beat_structure: analysis.beat_structure || null,
          viral_reason: analysis.viral_reason || null,
          is_commerce_safe: typeof analysis.is_commerce_safe === "boolean" ? analysis.is_commerce_safe : true,
          analyzed_full: analysis,
          updated_at: new Date().toISOString(),
        };
        const { error: updateErr } = await db.from("viral_videos").update(update).eq("id", video.id);
        if (updateErr) {
          results.push({ id: video.id, url: video.url, ok: false, error: updateErr.message });
          continue;
        }

        if (analysis.hook_text) {
          const hookNiche = video.niche || niche || nicheFromArticle("", "");
          try {
            await db.from("viral_hooks").upsert(
              {
                niche: hookNiche,
                hook_text: analysis.hook_text,
                video_source_id: video.id,
                structure: {
                  format: analysis.format_detected || null,
                  retention: analysis.viral_reason || null,
                },
                viability_score: 2,
                effectiveness_notes: "from reels-brain analyze",
              },
              { onConflict: "niche,hook_text", ignoreDuplicates: true },
            );
          } catch {
            try {
              const { count } = await db.from("viral_hooks").select("id", { count: "exact", head: true }).eq("niche", hookNiche).eq("hook_text", analysis.hook_text);
              if (!count) await db.from("viral_hooks").insert({ niche: hookNiche, hook_text: analysis.hook_text, video_source_id: video.id, viability_score: 2, effectiveness_notes: "from reels-brain analyze" });
            } catch { /* viral_hooks may be absent; corpus enrichment still succeeded */ }
          }
        }
        results.push({ id: video.id, url: video.url, ok: true, hook: analysis.hook_text, format: analysis.format_detected });
      } catch (e) {
        results.push({ id: video.id, url: video.url, ok: false, error: String((e as Error)?.message || e).slice(0, 120) });
      }
    }

    return NextResponse.json({
      ok: true,
      niche: niche || null,
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
