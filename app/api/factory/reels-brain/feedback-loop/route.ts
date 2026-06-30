import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildFeedbackSummary, buildOutcomeSignal, rememberFeedbackOutcome } from "@/lib/factory/reelsBrainFeedback";

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
  return { rows: (data || []) as { niche?: string; playbook?: Record<string, unknown>; updated_at?: string }[], error: null };
}

export async function GET(req: NextRequest) {
  try {
    const niches = splitList(req.nextUrl.searchParams.get("niches") || "ru_toys,ru_clothing,ru_cosmetics");
    const { rows, error } = await loadPlaybooks(niches);
    if (error) return NextResponse.json({ error }, { status: 500 });
    return NextResponse.json({
      ok: true,
      mode: "feedback_loop",
      niches,
      summary: buildFeedbackSummary(rows),
      notes: [
        "Feedback loop хранит outcome в playbook memory без миграции.",
        "POST сюда можно слать после публикации: pattern/brief + views/saves/completion/orders.",
      ],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "feedback-loop reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
    const body = await req.json().catch(() => ({}));
    const signal = buildOutcomeSignal(body);
    if (!signal.views) return NextResponse.json({ error: "нужны views для outcome" }, { status: 400 });
    const { data, error } = await db
      .from("niche_playbooks")
      .select("playbook")
      .eq("niche", signal.niche)
      .limit(1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const current = ((data as { playbook?: Record<string, unknown> }[] | null)?.[0]?.playbook || { niche: signal.niche }) as Record<string, unknown>;
    const playbook = rememberFeedbackOutcome(current, signal);
    const { error: upErr } = await db.from("niche_playbooks").upsert({
      niche: signal.niche,
      playbook: { ...playbook, niche: signal.niche },
      updated_at: new Date().toISOString(),
    }, { onConflict: "niche" });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    return NextResponse.json({
      ok: true,
      signal,
      summary: buildFeedbackSummary([{ niche: signal.niche, playbook }]),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "feedback-loop reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}

