import { NextRequest, NextResponse } from "next/server";
import { getRecipeHistoryResult } from "@/lib/factory/genHistory";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// V20 · История генераций по рецепту (кнопка «история» на карточке).
//   GET ?recipe_id=  → { ok, history:[{attempt,variant_idx,engine,otk_score,output_url,status,created_at,...}] }
// Мягко деградирует (пустой список), если миграция generation_history не применена.
export async function GET(req: NextRequest) {
  try {
    const recipeId = Number(req.nextUrl.searchParams.get("recipe_id"));
    if (!recipeId) return NextResponse.json({ ok: true, history: [], summary: null, note: "нужен recipe_id" }, { headers: { "Cache-Control": "no-store" } });
    const result = await getRecipeHistoryResult(recipeId, 100);
    return NextResponse.json({ ok: true, history: result.history, summary: result.summary || null, warning: result.warning || null }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ok: true, history: [], summary: null, warning: String((e as Error)?.message || e).slice(0, 160) }, { headers: { "Cache-Control": "no-store" } });
  }
}
