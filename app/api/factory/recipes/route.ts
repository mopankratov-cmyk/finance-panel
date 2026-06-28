import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { transferRecipeTemplate } from "@/lib/factory/recipeTransfer";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

// §15 «Перенести себе»: каркас конкурента (node_templates или nodes) → черновой node_recipes + node_recipe_nodes.
// КОПИРУЕТСЯ КАРКАС (slot/node_type/tool/тайминг), content ОБНУЛЯЕТСЯ под твой товар (asset_url/prompt/params пустые);
// оригинал конкурента → agent_suggestion (референс).
//   GET  ?recipe_id=                                  → отдать рецепт (голова + ноды)
//   GET  ?template_id=&article=&product_name=&mode=   → ПЕРЕНОС (удобный тест из браузера)
//   POST { template_id?|nodes?, article, product_name?, niche?, mode?, format? } → перенос
// Всегда JSON (обработчик в try/catch).


export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
    const sp = req.nextUrl.searchParams;
    const recipeId = sp.get("recipe_id");
    if (recipeId) {
      const [head, nodes] = await Promise.all([
        db.from("node_recipes").select("*").eq("id", recipeId).limit(1),
        db.from("node_recipe_nodes").select("*").eq("recipe_id", recipeId).order("ordinal"),
      ]);
      const recipe = (head.data as Record<string, unknown>[] | null)?.[0];
      if (!recipe) return NextResponse.json({ error: "рецепт не найден" }, { status: 404 });
      return NextResponse.json({ ok: true, recipe, nodes: nodes.data ?? [] });
    }
    // перенос через GET (удобный тест)
    if (sp.get("template_id") && sp.get("article")) {
      const r = await transferRecipeTemplate(db, { template_id: sp.get("template_id")!, article: sp.get("article")!, product_name: sp.get("product_name") || undefined, mode: sp.get("mode") || undefined });
      return NextResponse.json(r, { status: (r as { status?: number }).status || ((r as { error?: string }).error ? 400 : 200) });
    }
    return NextResponse.json({ error: "нужен recipe_id (просмотр) или template_id+article (перенос)" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: "recipes crash: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
    const body = await req.json().catch(() => ({}));
    const r = await transferRecipeTemplate(db, body);
    return NextResponse.json(r, { status: (r as { status?: number }).status || ((r as { error?: string }).error ? 400 : 200) });
  } catch (e) {
    return NextResponse.json({ error: "recipes crash: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}

// Удалить рецепт из библиотеки (ноды снимаются каскадом). DELETE ?recipe_id= или POST?_method=delete.
export async function DELETE(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
    const recipeId = req.nextUrl.searchParams.get("recipe_id");
    if (!recipeId) return NextResponse.json({ error: "нужен recipe_id" }, { status: 400 });
    const { error } = await db.from("node_recipes").delete().eq("id", recipeId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, deleted: recipeId });
  } catch (e) {
    return NextResponse.json({ error: "recipes crash: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
