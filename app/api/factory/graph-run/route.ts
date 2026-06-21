import { NextRequest, NextResponse, after } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildRunPlan, type RunPlan } from "@/lib/factory/graphRun";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// §17 V3: ЗАПУСК исполнения графа-рецепта. Машина (генерация→Shotstack→ОТК→банк) крутится в graph-run/tick.
//   POST { recipe_id }        → инициализирует run_plan, ставит status=running, дёргает первый тик
//   GET  ?recipe_id=          → состояние прогона (step + ноды + ОТК + output_url)
// Всегда JSON.
export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
    const body = await req.json().catch(() => ({}));
    const recipeId = Number(body.recipe_id);
    if (!recipeId) return NextResponse.json({ error: "нужен recipe_id" }, { status: 400 });

    const { data: rec } = await db.from("node_recipes").select("id,status,run_plan").eq("id", recipeId).limit(1);
    const recipe = (rec as Record<string, unknown>[] | null)?.[0];
    if (!recipe) return NextResponse.json({ error: "рецепт не найден" }, { status: 404 });

    // если уже бежит — не перезапускаем (идемпотентно), просто дёрнем тик
    const existing = recipe.run_plan as RunPlan | null;
    const running = recipe.status === "running" && existing && existing.step !== "done" && existing.step !== "failed";
    if (!running || body.restart) {
      const { data: nodes } = await db.from("node_recipe_nodes").select("ordinal,slot,node_type,tool,prompt,params,asset_url,duration_sec,agent_suggestion").eq("recipe_id", recipeId).order("ordinal");
      const rows = (nodes as Record<string, unknown>[] | null) || [];
      if (!rows.length) return NextResponse.json({ error: "у рецепта нет нод" }, { status: 400 });
      const plan = buildRunPlan(rows);
      if (body.notify) plan.notify = true; // V21/R5: батч-прогон → слать прошедшее ОТК в Telegram
      await db.from("node_recipes").update({ run_plan: plan, status: "running", otk_verdict: null, otk_score: null, output_url: null, render_id: null, updated_at: new Date().toISOString() }).eq("id", recipeId);
    }

    const origin = req.nextUrl.origin;
    after(async () => { try { await fetch(`${origin}/api/factory/graph-run/tick`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipe_id: recipeId }), signal: AbortSignal.timeout(20000) }); } catch { /* воскресит ручной тик */ } });

    return NextResponse.json({ ok: true, recipe_id: recipeId, started: true });
  } catch (e) {
    return NextResponse.json({ error: "graph-run crash: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
    const recipeId = Number(req.nextUrl.searchParams.get("recipe_id"));
    if (!recipeId) return NextResponse.json({ error: "нужен recipe_id" }, { status: 400 });
    const { data } = await db.from("node_recipes").select("id,status,run_plan,otk_verdict,otk_score,output_url,render_id").eq("id", recipeId).limit(1);
    const recipe = (data as Record<string, unknown>[] | null)?.[0];
    if (!recipe) return NextResponse.json({ error: "рецепт не найден" }, { status: 404 });
    const plan = recipe.run_plan as RunPlan | null;
    const nodes = (plan?.nodes || []).map((n) => ({ ordinal: n.ordinal, slot: n.slot, node_type: n.node_type, tool: n.tool, status: n.status, url: n.url || null, error: n.error || null, engine: n.engine || null }));

    // САМО-ВОСКРЕШЕНИЕ: цепочка тиков могла оборваться (Vercel убил after / транзиент). Если прогон активен,
    // а лиз протух → дёргаем тик. Опрос статуса из кокпита заодно поддерживает цепочку живой (лиз бережёт от дубля).
    if (recipe.status === "running" && plan && plan.step !== "done" && plan.step !== "failed") {
      const leaseFree = !plan.lease_until || new Date(plan.lease_until).getTime() < Date.now();
      if (leaseFree) {
        const origin = req.nextUrl.origin;
        after(async () => { try { await fetch(`${origin}/api/factory/graph-run/tick`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipe_id: recipeId }), signal: AbortSignal.timeout(15000) }); } catch { /* следующий опрос воскресит */ } });
      }
    }

    return NextResponse.json({ ok: true, recipe_id: recipeId, status: recipe.status, step: plan?.step || null, nodes, otk: recipe.otk_verdict, otk_score: recipe.otk_score, output_url: recipe.output_url, error: plan?.error || null }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "graph-run crash: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
