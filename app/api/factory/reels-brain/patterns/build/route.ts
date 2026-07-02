import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildReelsPatternMemory, type ReelsPatternSourceVideo } from "@/lib/factory/reelsBrainPatterns";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUPABASE_PAGE_SIZE = 1000;

async function loadPatternSourceVideos(
  db: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  niche: string,
  limit: number,
): Promise<{ rows: ReelsPatternSourceVideo[]; error: string | null }> {
  const rows: ReelsPatternSourceVideo[] = [];
  for (let from = 0; from < limit; from += SUPABASE_PAGE_SIZE) {
    const to = Math.min(from + SUPABASE_PAGE_SIZE - 1, limit - 1);
    const { data, error } = await db
      .from("viral_videos")
      .select("id,url,platform,caption,hook_text,format_detected,beat_structure,viral_reason,virality_score,views,sound_title,analyzed_full")
      .eq("niche", niche)
      .order("virality_score", { ascending: false, nullsFirst: false })
      .range(from, to);
    if (error) return { rows, error: error.message };
    const page = ((data || []) as ReelsPatternSourceVideo[]);
    rows.push(...page);
    if (page.length < to - from + 1) break;
  }
  return { rows, error: null };
}

// POST { niche, limit?, persist? } or GET ?niche=&limit=&persist=true
// Builds deterministic Pattern Memory from viral_videos. persist=true embeds it into niche_playbooks.playbook.
async function build(req: NextRequest, body: Record<string, unknown>) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const sp = req.nextUrl.searchParams;
  const niche = String(body.niche || sp.get("niche") || "").trim();
  if (!niche) return NextResponse.json({ error: "нужна niche" }, { status: 400 });
  const limit = Math.min(3000, Math.max(10, Number(body.limit || sp.get("limit") || 300)));
  const persist = body.persist === true || sp.get("persist") === "true";

  const { rows, error } = await loadPatternSourceVideos(db, niche, limit);
  if (error) return NextResponse.json({ error: "viral_videos: " + error }, { status: 500 });
  const { data: existing } = await db
    .from("niche_playbooks")
    .select("playbook")
    .eq("niche", niche)
    .limit(1);
  const current = ((existing as { playbook: Record<string, unknown> }[] | null)?.[0]?.playbook || {}) as Record<string, unknown>;
  const memory = buildReelsPatternMemory(niche, rows, new Date(), { playbook: current });
  let persisted = false;
  let warning: string | null = null;

  if (persist) {
    try {
      const playbook = {
        ...current,
        niche,
        reels_brain_patterns: memory,
        updated_by: "reels-brain-patterns",
      };
      const { error: upErr } = await db.from("niche_playbooks").upsert({
        niche,
        playbook,
        updated_at: new Date().toISOString(),
      }, { onConflict: "niche" });
      if (upErr) warning = upErr.message;
      else persisted = true;
    } catch (e) {
      warning = String((e as Error)?.message || e).slice(0, 160);
    }
  }

  return NextResponse.json({
    ok: true,
    niche,
    source_videos: rows.length,
    persist,
    persisted,
    warning,
    memory,
    summary: {
      meta_patterns: memory.meta_brain.patterns.length,
      generator_ready_patterns: memory.meta_brain.generator_ready_patterns.length,
      quality_summary: memory.meta_brain.quality_summary,
      cross_platform_patterns: memory.cross_platform_patterns.length,
      platform_brains: Object.fromEntries(
        Object.entries(memory.platform_brains).map(([platform, brain]) => [
          platform,
          {
            total_videos: brain?.total_videos || 0,
            analyzed_videos: brain?.analyzed_videos || 0,
            patterns: brain?.patterns.length || 0,
            generator_ready_patterns: brain?.generator_ready_patterns.length || 0,
            quality_summary: brain?.quality_summary || null,
          },
        ]),
      ),
    },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  try {
    return build(req, {});
  } catch (e) {
    return NextResponse.json({ error: "patterns/build reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    return build(req, body);
  } catch (e) {
    return NextResponse.json({ error: "patterns/build reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
