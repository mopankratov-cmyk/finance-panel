import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildPortfolioManagerFromPlaybooks } from "@/lib/factory/reelsBrainPortfolioManager";

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

    const portfolio = buildPortfolioManagerFromPlaybooks(rows, limit);
    return NextResponse.json({
      ok: true,
      mode: "portfolio_manager",
      niches,
      summary: {
        slots: portfolio.slots.length,
        outcomes: portfolio.summary.outcomes,
        winners: portfolio.summary.winners,
        launch_experiments: portfolio.summary.launch_experiments,
        ship_candidates: portfolio.summary.ship_candidates,
      },
      portfolio,
      notes: [
        "Portfolio Manager связывает outcomes, simulation и experiments в next publishing slots.",
        "Не генерирует контент сам: дает очередь, микс недели и метрики для контроля.",
        "Реальные post_metrics должны возвращаться в feedback-loop.",
      ],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "portfolio-manager reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
