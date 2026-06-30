import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildAudioIntelligenceFromPlaybooks } from "@/lib/factory/reelsBrainAudioIntelligence";

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

    const audio = buildAudioIntelligenceFromPlaybooks(rows, limit);
    return NextResponse.json({
      ok: true,
      mode: "audio_intelligence",
      niches,
      summary: {
        patterns: audio.total_patterns,
        sound_titles: audio.top_sound_titles.length,
        strategies: audio.strategy_mix.length,
        worker_stages: audio.next_pipeline.filter((stage) => stage.status === "needs_worker").length,
      },
      audio,
      notes: [
        "MVP строится из Pattern Brain и sound_title без скачивания видео.",
        "Следующий уровень точности: FFmpeg + WhisperX + Librosa/Essentia worker.",
        "Audio rules можно отдавать Editor Brain для ритма монтажа и первых 2 секунд.",
      ],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "audio-intelligence reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
