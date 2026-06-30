import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildCreativeMemoryFromPlaybooks } from "@/lib/factory/reelsBrainCreativeMemory";

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

    const memory = buildCreativeMemoryFromPlaybooks(rows, limit);
    return NextResponse.json({
      ok: true,
      mode: "creative_memory",
      niches,
      summary: {
        atoms: memory.total_atoms,
        dna: memory.total_dna,
        anti_patterns: memory.anti_patterns.length,
        experiment_skeletons: memory.experiment_skeletons.length,
        product_brains: memory.product_brain.length,
        audience_brains: memory.audience_brain.length,
      },
      memory,
      notes: [
        "Creative Memory строится из Pattern Brain: лучшие хуки, CTA, камера, монтаж, B-roll, аудио, продукт и аудитория.",
        "Creative DNA хранит комбинации атомов, а не копии чужих роликов.",
        "Anti-patterns показывают, что запрещено масштабировать без проверки.",
      ],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "creative-memory reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
