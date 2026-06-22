import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { internalFetch } from "@/lib/internalFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

// R4 · 3 варианта на ТЗ: клонирует рецепт N-1 раз, в каждом клоне — ДРУГОЙ хук (из /variations, меняем
// ОДИН рычаг — хук). Все варианты генерятся → рынок (post-metrics/winners) скажет, который залетел.
// Это A/B на объёме поверх готового рецепта. Хук — ось №1 залёта (как в хук-турнире V9).
//   POST { recipe_id, n? } → { ok, base, variants:[recipe_id…], hooks:[…] }
export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    const b = await req.json().catch(() => ({}));
    const recipeId = Number(b.recipe_id) || 0;
    const n = Math.min(4, Math.max(2, Number(b.n) || 3)); // всего вариантов (вкл. базовый) — делаем n-1 клонов
    if (!recipeId) return NextResponse.json({ ok: false, error: "нужен recipe_id" }, { status: 400 });

    // 1) база: рецепт + ноды
    const { data: recRows } = await db.from("node_recipes").select("id,article,niche,mode,format_detected").eq("id", recipeId).limit(1);
    const rec = (recRows as Record<string, unknown>[] | null)?.[0];
    if (!rec) return NextResponse.json({ ok: false, error: "рецепт не найден" }, { status: 404 });
    const { data: nodeRows } = await db.from("node_recipe_nodes").select("*").eq("recipe_id", recipeId).order("ordinal", { ascending: true });
    const nodes = (nodeRows as Record<string, unknown>[] | null) || [];
    if (!nodes.length) return NextResponse.json({ ok: false, error: "у рецепта нет нод" }, { status: 400 });

    const isHook = (nd: Record<string, unknown>) => {
      const role = String(((nd.params as Record<string, unknown>)?.role) || nd.slot || "").toLowerCase();
      const t = String(nd.node_type || "").toLowerCase();
      return role === "hook" || t.indexOf("hook") === 0;
    };
    const hookNode = nodes.find(isHook);
    const baseHook = String((hookNode?.params as Record<string, unknown>)?.onscreen_text || hookNode?.prompt || hookNode?.onscreen_text || "").trim();
    if (!hookNode || !baseHook) return NextResponse.json({ ok: false, error: "нет отдельной hook-ноды с текстом — варианты строятся вокруг хука (для рецепта без hook-ноды недоступно)" }, { status: 400 });

    // 2) варьируем ОДИН рычаг (хук) через /variations
    const article = String(rec.article || "");
    let variedHooks: string[] = [];
    try {
      const vr = await internalFetch(`${req.nextUrl.origin}/api/factory/variations`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hook: baseHook, article, product_name: article, count: Math.max(3, n + 1) }),
        signal: AbortSignal.timeout(35000),
      }).then((r) => r.json());
      variedHooks = ((vr?.variations as Record<string, unknown>[]) || []).map((v) => String(v?.hook || "").trim()).filter((h) => h && h !== baseHook);
    } catch { /* вариации опциональны */ }
    variedHooks = [...new Set(variedHooks)].slice(0, n - 1);
    if (!variedHooks.length) return NextResponse.json({ ok: false, error: "вариации хука не вышли (Claude/variations)" }, { status: 502 });

    // 3) клон рецепта на каждый новый хук (копируем ноды, в hook-ноде подменяем текст хука)
    const variants: number[] = []; const createdHooks: string[] = []; // createdHooks синхронен variants (если клон упал — оба не растут)
    for (const vh of variedHooks) {
      const { data: nr, error: rErr } = await db.from("node_recipes").insert({
        article: rec.article, niche: rec.niche, mode: rec.mode, format_detected: rec.format_detected,
        built_by: "auto", status: "draft", recipe_confidence: 1,
      }).select("id").maybeSingle();
      if (rErr || !nr) continue;
      const newId = (nr as { id: number }).id;
      const rows = nodes.map((nd) => {
        // только плоский объект спредим (мусор-строка/массив из БД → {} вместо indexed-corruption)
        const p = nd.params; const params: Record<string, unknown> = (p && typeof p === "object" && !Array.isArray(p)) ? { ...(p as Record<string, unknown>) } : {};
        let prompt = nd.prompt;
        if (isHook(nd)) { params.onscreen_text = vh; prompt = vh; } // подменяем хук (всегда оба — паритет prompt/onscreen_text)
        return {
          recipe_id: newId, ordinal: nd.ordinal, slot: nd.slot, node_type: nd.node_type, tool: nd.tool,
          prompt, params, asset_url: nd.asset_url || "", duration_sec: nd.duration_sec,
          source: "variant", human_edited: false, agent_suggestion: nd.agent_suggestion,
        };
      });
      const { error: nErr } = await db.from("node_recipe_nodes").insert(rows);
      if (nErr) { await db.from("node_recipes").delete().eq("id", newId); continue; } // откат осиротевшей головы
      const graph_doc = {
        nodes: rows.map((r, i) => ({ id: `n${r.ordinal}`, type: r.node_type, slot: r.slot, tool: r.tool, position: { x: i * 240, y: 0 }, duration_sec: r.duration_sec, status: "draft" })),
        edges: rows.slice(1).map((r, i) => ({ id: `e${i}`, source: `n${rows[i].ordinal}`, target: `n${r.ordinal}` })),
      };
      await db.from("node_recipes").update({ graph_doc }).eq("id", newId);
      variants.push(newId); createdHooks.push(vh);
    }

    return NextResponse.json({ ok: true, base: recipeId, variants, hooks: [baseHook, ...createdHooks], note: `${variants.length} вариант(ов) с другими хуками — генерь все, рынок выберет залетевший.` });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "recipe-variants crash: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
