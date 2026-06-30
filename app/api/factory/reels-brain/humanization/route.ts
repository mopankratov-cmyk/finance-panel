import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildHumanizationBrainFromPlaybooks } from "@/lib/factory/reelsBrainHumanization";

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
    const limit = Math.max(1, Math.min(100, Number(sp.get("limit") || 50)));
    const { rows, error } = await loadPlaybooks(niches);
    if (error) return NextResponse.json({ error }, { status: error.includes("Supabase") ? 500 : 400 });

    const humanization = buildHumanizationBrainFromPlaybooks(rows, limit);
    return NextResponse.json({
      ok: true,
      mode: "humanization_brain",
      niches,
      summary: {
        recipes: humanization.total_recipes,
        moves: humanization.move_mix.length,
        prompt_patches: humanization.prompt_patches.length,
        high_risk: humanization.recipes.filter((row) => row.ai_slop_risk === "high").length,
      },
      humanization,
      notes: [
        "Humanization Brain добавляет UGC-живость и снижает AI-slop риск.",
        "prompt_patches можно добавлять в генератор/режиссера перед созданием ролика.",
        "Это deterministic MVP без LLM-вызовов и без новых расходов.",
      ],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "humanization reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
