import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildRunPlan, makeRunId } from "@/lib/factory/graphRun";
import type { RunPlan } from "@/lib/factory/graphTypes";
import { buildRunSummary } from "@/lib/factory/observability";
import { internalFetch } from "@/lib/internalFetch";
import { estimateRunCost } from "@/lib/factory/costEstimate";

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
    // restart НЕ затирает активно бегущий рецепт с живым лизом: иначе buildRunPlan сбросит mid-генерации
    // ноды в pending (потеря токенов fal → двойной сабмит). Перезапуск только если лиз свободен/протух.
    const leaseFree = !existing || !existing.lease_until || new Date(existing.lease_until as string).getTime() < Date.now();
    if (!running || (body.restart && leaseFree)) {
      const { data: nodes } = await db.from("node_recipe_nodes").select("ordinal,slot,node_type,tool,prompt,params,asset_url,duration_sec,agent_suggestion").eq("recipe_id", recipeId).order("ordinal");
      const rows = (nodes as Record<string, unknown>[] | null) || [];
      if (!rows.length) return NextResponse.json({ error: "у рецепта нет нод" }, { status: 400 });
      const plan = buildRunPlan(rows);
      plan.cost_hint = estimateRunCost(rows);
      plan.run_id = makeRunId(recipeId);
      const prevPlan = existing && typeof existing === "object" ? existing : null;
      plan.execution_log = Array.isArray(prevPlan?.execution_log) ? prevPlan.execution_log : [];
      plan.warnings = [];
      if (body.notify) plan.notify = true; // V21/R5: батч-прогон → слать прошедшее ОТК в Telegram
      if (body.autofill) plan.step = "autofill"; // V21: батч-черновик сам сконфигурируется (§17) перед генерацией
      await db.from("node_recipes").update({ run_plan: plan, status: "running", otk_verdict: null, otk_score: null, output_url: null, render_id: null, updated_at: new Date().toISOString() }).eq("id", recipeId);
    }

    const origin = req.nextUrl.origin;
    // первый тик СИНХРОННО: сам chain живёт в graph-run/tick, крон — только страховка.
    try { await internalFetch(`${origin}/api/factory/graph-run/tick`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipe_id: recipeId }), signal: AbortSignal.timeout(20000) }); } catch { /* воскресит крон/ручной тик */ }

    const { data: after } = await db.from("node_recipes").select("run_plan").eq("id", recipeId).limit(1);
    const plan = ((after as Record<string, unknown>[] | null)?.[0]?.run_plan as RunPlan | null) || null;
    return NextResponse.json({ ok: true, recipe_id: recipeId, started: true, run_id: plan?.run_id || null, cost_hint: plan?.cost_hint || null });
  } catch (e) {
    return NextResponse.json({ error: "graph-run упал: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
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
    // Sprint 1: read-path должен быть read-only. Оркестрация живёт в POST /graph-run,
    // self-chain /graph-run/tick и cron-strategy, а не в status polling.
    const nodes = (plan?.nodes || []).map((n) => ({ ordinal: n.ordinal, slot: n.slot, node_type: n.node_type, tool: n.tool, status: n.status, url: n.url || null, error: n.error || null, engine: n.engine || null }));
    return NextResponse.json({ ok: true, recipe_id: recipeId, run_id: plan?.run_id || null, status: recipe.status, step: plan?.step || null, nodes, otk: recipe.otk_verdict, otk_score: recipe.otk_score, output_url: recipe.output_url, error: plan?.error || null, warnings: plan?.warnings || null, execution_log: plan?.execution_log || [], run_summary: buildRunSummary(plan), cost_hint: plan?.cost_hint || (plan?.nodes ? estimateRunCost(plan.nodes as unknown as Record<string, unknown>[]) : null) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "graph-run упал: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
