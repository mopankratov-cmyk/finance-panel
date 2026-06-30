import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildSimulationBrainFromPlaybooks } from "@/lib/factory/reelsBrainSimulation";

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

    const simulation = buildSimulationBrainFromPlaybooks(rows, limit);
    return NextResponse.json({
      ok: true,
      mode: "simulation_brain",
      niches,
      summary: {
        simulations: simulation.total_simulations,
        ship: simulation.top_ship_candidates.length,
        revise: simulation.revise_queue.filter((row) => row.readiness === "revise").length,
        hold: simulation.revise_queue.filter((row) => row.readiness === "hold").length,
        personas: simulation.persona_summary.length,
      },
      simulation,
      notes: [
        "Simulation Brain оценивает Creative DNA + Audio + Visual перед генерацией.",
        "Это deterministic MVP: виртуальная фокус-группа без LLM-вызова и без расходов.",
        "Дальше можно подключить реальные outcome metrics и LLM critic для более тонких правок.",
      ],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "simulation reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
