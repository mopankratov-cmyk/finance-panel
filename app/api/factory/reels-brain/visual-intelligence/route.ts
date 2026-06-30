import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildVisualIntelligenceFromPlaybooks } from "@/lib/factory/reelsBrainVisualIntelligence";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

function splitList(value: unknown): string[] {
  return Array.from(new Set(String(value || "")
    .split(",")
    .map((row) => row.trim())
    .filter(Boolean)))
    .slice(0, 30);
}

async function loadPlaybooks(niches: string[]) {
  const db = getSupabaseAdmin();
  if (!db) return { rows: [], error: "Supabase не настроен" };
  const { data, error } = await db
    .from("niche_playbooks")
    .select("niche,playbook,updated_at")
    .in("niche", niches);
  if (error) return { rows: [], error: error.message };
  return {
    rows: ((data || []) as { niche?: string; playbook?: unknown; updated_at?: string }[]),
    error: null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const niches = splitList(sp.get("niches") || "ru_toys,ru_clothing,ru_cosmetics");
    const limit = Math.max(1, Math.min(200, Number(sp.get("limit") || 80)));
    const { rows, error } = await loadPlaybooks(niches);
    if (error) return NextResponse.json({ error }, { status: error.includes("Supabase") ? 500 : 400 });

    const visual = buildVisualIntelligenceFromPlaybooks(rows, limit);
    return NextResponse.json({
      ok: true,
      mode: "visual_intelligence",
      niches,
      summary: {
        patterns: visual.total_patterns,
        camera_styles: visual.camera_mix.length,
        editing_moves: visual.editing_mix.length,
        editor_payloads: visual.editor_payloads.length,
      },
      visual,
      notes: [
        "Visual Intelligence строится из Pattern Brain без нового сбора.",
        "Camera Brain выбирает ракурс под proof, Editing Brain выбирает монтажные moves под удержание.",
        "editor_payloads можно отдавать монтажному/генераторному слою как структуру по секундам.",
      ],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "visual-intelligence reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
