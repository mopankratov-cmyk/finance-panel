import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildReelsPatternMemory, type ReelsPatternSourceVideo } from "@/lib/factory/reelsBrainPatterns";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type ViralVideoRow = ReelsPatternSourceVideo & {
  niche?: string | null;
};

function parseRequestedNiches(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((row) => String(row || "").trim()).filter(Boolean)));
  }
  return Array.from(new Set(String(value || "").split(",").map((row) => row.trim()).filter(Boolean)));
}

async function buildAll(req: NextRequest, body: Record<string, unknown>) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const sp = req.nextUrl.searchParams;
  const limitPerNiche = Math.min(3000, Math.max(10, Number(body.limit || sp.get("limit") || 3000)));
  const maxCorpusRows = Math.min(20000, Math.max(limitPerNiche, Number(body.max_corpus_rows || sp.get("max_corpus_rows") || 20000)));
  const requestedNiches = parseRequestedNiches(body.niches || sp.get("niches"));

  let query = db
    .from("viral_videos")
    .select("id,url,platform,niche,caption,hook_text,format_detected,beat_structure,viral_reason,virality_score,views,sound_title")
    .order("virality_score", { ascending: false, nullsFirst: false })
    .limit(maxCorpusRows);
  if (requestedNiches.length) query = query.in("niche", requestedNiches);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "viral_videos: " + error.message }, { status: 500 });

  const byNiche = new Map<string, ViralVideoRow[]>();
  for (const row of ((data || []) as ViralVideoRow[])) {
    const niche = String(row.niche || "").trim();
    if (!niche) continue;
    if (!byNiche.has(niche)) byNiche.set(niche, []);
    const rows = byNiche.get(niche);
    if (rows && rows.length < limitPerNiche) rows.push(row);
  }

  const results = [];
  for (const [niche, rows] of Array.from(byNiche.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const memory = buildReelsPatternMemory(niche, rows);
    const { data: existing, error: existingError } = await db
      .from("niche_playbooks")
      .select("playbook")
      .eq("niche", niche)
      .limit(1);
    if (existingError) {
      results.push({ niche, ok: false, source_videos: rows.length, error: existingError.message });
      continue;
    }

    const current = ((existing as { playbook: Record<string, unknown> }[] | null)?.[0]?.playbook || {}) as Record<string, unknown>;
    const playbook = {
      ...current,
      niche,
      reels_brain_patterns: memory,
      updated_by: "reels-brain-patterns-build-all",
    };
    const { error: upsertError } = await db.from("niche_playbooks").upsert({
      niche,
      playbook,
      updated_at: new Date().toISOString(),
    }, { onConflict: "niche" });

    results.push({
      niche,
      ok: !upsertError,
      source_videos: rows.length,
      analyzed_videos: memory.analyzed_videos,
      meta_patterns: memory.meta_brain.patterns.length,
      cross_platform_patterns: memory.cross_platform_patterns.length,
      platform_brains: Object.fromEntries(
        Object.entries(memory.platform_brains).map(([platform, brain]) => [
          platform,
          {
            total_videos: brain?.total_videos || 0,
            analyzed_videos: brain?.analyzed_videos || 0,
            patterns: brain?.patterns.length || 0,
          },
        ]),
      ),
      persisted: !upsertError,
      error: upsertError?.message || null,
    });
  }

  return NextResponse.json({
    ok: results.every((row) => row.ok),
    limit_per_niche: limitPerNiche,
    scanned_rows: (data || []).length,
    niches: results.length,
    total_source_videos: results.reduce((sum, row) => sum + row.source_videos, 0),
    results,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  try {
    return buildAll(req, {});
  } catch (e) {
    return NextResponse.json({ error: "patterns/build-all reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return buildAll(req, body);
  } catch (e) {
    return NextResponse.json({ error: "patterns/build-all reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
