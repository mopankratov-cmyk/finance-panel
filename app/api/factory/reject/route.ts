import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { logGeneration } from "@/lib/factory/genHistory";
import { nicheFromArticle } from "@/lib/factory/rubric";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// V1 · «✕ Не то» — фиксируем РЕДЖЕКТ оператора с причиной (раньше был голый toast).
//   POST { recipe_id?, node_id?, url?, hook?, reason, niche?, article? }
//   → cf_signals event='rejected' (reason_chip — читает V7 как анти-паттерн ниши)
//   → generation_history status='rejected' (V20 — память «забраковано и почему»)
// Без этого петля одобрения рвётся: «не то» не доезжает до обучения. Best-effort, всегда JSON.
export async function POST(req: NextRequest) {
  try {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
  const b = await req.json().catch(() => ({}));
  const reason = (b.reason || "не то").toString().slice(0, 80);
  const article = (b.article || "").toString().trim();
  const niche = b.niche || nicheFromArticle(article, (b.hook || "").toString());
  const recipe_id = typeof b.recipe_id === "number" ? b.recipe_id : null;
  const node_id = typeof b.node_id === "number" ? b.node_id : null;

  try {
    await db.from("cf_signals").insert({
      event: "rejected", reason_chip: reason, recipe_id, node_id,
      niche, article: article || null, mode: b.mode || null,
    });
  } catch { /* журнал best-effort (таблица/колонка reason_chip может отсутствовать) */ }

  // память итераций: помечаем забракованное (для «истории» и обучения)
  await logGeneration({
    recipe_id, node_id, output_url: (b.url || null), prompt: (b.hook || null),
    status: "rejected", reason, source: "studio", niche, article: article || null,
  });

  return NextResponse.json({ ok: true, reason });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      reason: "",
      error: "reject crash: " + String((e as Error)?.message || e).slice(0, 160),
    }, { status: 500 });
  }
}
