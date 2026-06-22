import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { claimNextRecipe, runRecipeStep, MAX_STEP_ATTEMPTS, type RunPlan } from "@/lib/factory/graphRun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Vercel Cron · СТРАХОВКА надёжности графа-исполнителя. self-chain тиков (graph-run/tick) делает работу в
// Vercel after() — а after() НЕ исполняется надёжно при server-to-server вызове (крон→internalFetch→tick):
// тик отвечает, but after() с runRecipeStep не докручивается → рецепт висит status=running, pollCount не растёт
// (диагностировано вживую: крон звал тик, graph_resurrect писался, а шаг не исполнялся). Поэтому здесь крон
// гоняет runRecipeStep СИНХРОННО (await в своём хендлере) — гарантированно, без зависимости от after().
// Будит зависшие: status=running + активный шаг + updated_at>90с (здоровая цепочка освежает ~12с) + лиз свободен.
// claimNextRecipe ставит CAS-лиз → нет двойного захвата с живой цепочкой. Один шаг на рецепт за прогон;
// 2-минутный такт доводит рецепт по шагам (render-poll→otk→bank→done). cf_signals graph_resurrect — телеметрия.
// vercel.json: { "path": "/api/factory/graph-run/cron", "schedule": "*/2 * * * *" }. Auth: Bearer CRON_SECRET.

const STALE_MS = 90_000;   // > самого долгого здорового «молчания» шага → не трогаем живые
const MAX_WAKE = 10;       // синхронно гоняем шаги → держим в бюджете maxDuration; остальное добьёт след. прогон

function leaseFree(plan: RunPlan | null): boolean {
  if (!plan) return false;
  if (!plan.lease_until) return true;
  const t = new Date(plan.lease_until as string).getTime();
  return !Number.isFinite(t) || t < Date.now();
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const secret = process.env.CRON_SECRET || "";
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const staleBefore = new Date(Date.now() - STALE_MS).toISOString();
  const { data } = await db.from("node_recipes")
    .select("id,run_plan,updated_at")
    .eq("status", "running")
    .lt("updated_at", staleBefore)
    .order("updated_at", { ascending: true })
    .limit(MAX_WAKE);

  const rows = (data as { id: number; run_plan: RunPlan | null }[] | null) || [];
  const stuck = rows.filter((r) => {
    const p = r.run_plan;
    return p && p.step !== "done" && p.step !== "failed" && leaseFree(p);
  });

  const origin = req.nextUrl.origin;
  const woken: number[] = [];
  const advanced: { id: number; from: string }[] = [];

  await Promise.all(stuck.map(async (row) => {
    const ctx = await claimNextRecipe(db, row.id);
    if (!ctx) return;                                   // лиз заняла живая цепочка / гонка — пропускаем
    woken.push(row.id);
    const before = ctx.plan.step;
    try {
      await runRecipeStep(db, origin, ctx);             // СИНХРОННО — гарантированный шаг (не через after())
      const p = ctx.plan;
      if (p.attempts) { p.attempts = 0; await db.from("node_recipes").update({ run_plan: p, updated_at: new Date().toISOString() }).eq("id", ctx.id); }
      advanced.push({ id: row.id, from: before });
    } catch (e) {
      // зеркалит обработку ошибки в graph-run/tick: ретрай шага до MAX_STEP_ATTEMPTS, затем run_fail. Лиз снимаем.
      const msg = String(e instanceof Error ? e.message : e).slice(0, 300);
      const plan = ctx.plan;
      const attempts = (plan.attempts || 0) + 1;
      plan.attempts = attempts; plan.error = msg; plan.lease_until = null;
      if (attempts >= MAX_STEP_ATTEMPTS) { plan.step = "failed"; await db.from("node_recipes").update({ run_plan: plan, status: "run_fail", updated_at: new Date().toISOString() }).eq("id", ctx.id); }
      else await db.from("node_recipes").update({ run_plan: plan, updated_at: new Date().toISOString() }).eq("id", ctx.id);
    }
  }));

  if (woken.length) {
    try { await db.from("cf_signals").insert({ event: "graph_resurrect", params: { woken, advanced, scanned: rows.length } }); } catch { /* журнал best-effort */ }
    console.warn(`[graph-cron] разбужено: ${woken.length} (${woken.join(",")}), продвинуто: ${advanced.length}`);
  }

  return NextResponse.json({ ok: true, scanned: rows.length, stuck: stuck.length, woken, advanced });
}
