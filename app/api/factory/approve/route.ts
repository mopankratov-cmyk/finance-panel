import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { logGeneration } from "@/lib/factory/genHistory";
import { nicheFromArticle } from "@/lib/factory/rubric";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

// Явный internal quality feedback для learning gate.
// Это НЕ market winner: не помечает content_assets.is_winner и не сидит viral_hooks на 5.
// POST { recipe_id, url?, hook?, note?, niche?, article? } -> cf_signals event='approved'
export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    const body = await req.json().catch(() => ({}));
    const recipeId = Number(body.recipe_id) || 0;
    if (!recipeId) return NextResponse.json({ ok: false, error: "нужен recipe_id" }, { status: 400 });

    const article = String(body.article || "").trim();
    const hook = String(body.hook || "").trim();
    const niche = String(body.niche || "").trim() || nicheFromArticle(article, hook);
    const reason = String(body.note || "quality approved").slice(0, 80);

    await db.from("cf_signals").insert({
      event: "approved",
      recipe_id: recipeId,
      niche,
      article: article || null,
      reason_chip: reason,
      params: { source: "studio_learning_queue", feedback_type: "quality" },
    });

    await logGeneration({
      recipe_id: recipeId,
      output_url: body.url || null,
      prompt: hook || null,
      status: "approved",
      reason,
      source: "studio",
      niche,
      article: article || null,
    });

    return NextResponse.json({ ok: true, recipe_id: recipeId, status: "approved" });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "approve crash: " + String((e as Error)?.message || e).slice(0, 160),
    }, { status: 500 });
  }
}
