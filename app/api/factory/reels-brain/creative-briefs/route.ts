import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildCreativeBriefsFromPlaybooks } from "@/lib/factory/reelsBrainCreativeBriefs";

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
    const limit = Math.max(1, Math.min(50, Number(sp.get("limit") || 10)));
    const { rows, error } = await loadPlaybooks(niches);
    if (error) return NextResponse.json({ error }, { status: error.includes("Supabase") ? 500 : 400 });
    const briefs = buildCreativeBriefsFromPlaybooks(rows, limit);
    return NextResponse.json({
      ok: true,
      mode: "creative_briefs",
      niches,
      count: briefs.length,
      briefs,
      generator_payloads: briefs.map((brief) => brief.generator_payload),
      notes: [
        "Briefs построены из Pattern Brain, без нового сбора и без расходов провайдера.",
        "Использовать как механику: хук, удержание, структуру, visual recipe. Не копировать исходные видео.",
      ],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "creative-briefs reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}

