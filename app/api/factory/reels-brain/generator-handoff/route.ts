import { NextRequest, NextResponse } from "next/server";
import { buildGeneratorHandoffFromPlaybooks } from "@/lib/factory/reelsBrainGeneratorHandoff";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

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
    const limit = Math.max(1, Math.min(50, Number(sp.get("limit") || 20)));
    const { rows, error } = await loadPlaybooks(niches);
    if (error) return NextResponse.json({ error }, { status: error.includes("Supabase") ? 500 : 400 });

    const handoff = buildGeneratorHandoffFromPlaybooks(rows, limit);
    return NextResponse.json({
      ok: true,
      mode: "generator_handoff",
      niches,
      summary: {
        payloads: handoff.total_payloads,
        ready: handoff.ready,
        needs_revision: handoff.needs_revision,
        hold: handoff.hold,
      },
      handoff,
      generator_payloads: handoff.payloads.map((payload) => payload.generator_payload),
      notes: [
        "Generator Handoff собирает brief + humanization + simulation + experiment + safety в один payload.",
        "ready_to_generate можно отдавать в сценарист/режиссер слой; hold не запускать без правки риска.",
        "Это deterministic MVP без LLM-вызовов и без дополнительных расходов.",
      ],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "generator-handoff reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
