import { NextRequest, NextResponse, after } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { claimNextRecipe, runRecipeStep, MAX_STEP_ATTEMPTS, type RunPlan } from "@/lib/factory/graphRun";
import { internalFetch } from "@/lib/internalFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Тик исполнителя графа: захватывает один рецепт (status=running), делает ОДИН шаг, дёргает следующий тик.
// По образцу jobs/tick — ошибка шага ретраится до MAX_STEP_ATTEMPTS, затем failed. Всегда JSON.
export async function POST(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const origin = req.nextUrl.origin;
  const body = await req.json().catch(() => ({}));
  const recipeId = body.recipe_id ? Number(body.recipe_id) : undefined;

  const ctx = await claimNextRecipe(db, recipeId);
  if (!ctx) return NextResponse.json({ idle: true });

  after(async () => {
    try {
      await runRecipeStep(db, origin, ctx);
      // успешный шаг → сбрасываем счётчик ИСКЛЮЧЕНИЙ (он про ПОДРЯД-фейлы шага, не про весь ран).
      // Иначе 3 транзиента (502 критика/Shotstack/таймаут), размазанные по длинному прогону
      // с реген-петлёй (×3 рендера), убивали ран в run_fail и ВЫБРАСЫВАЛИ оплаченный лучший результат.
      const p = ctx.plan as RunPlan;
      if (p.attempts) { p.attempts = 0; await db.from("node_recipes").update({ run_plan: p, updated_at: new Date().toISOString() }).eq("id", ctx.id); }
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e).slice(0, 300);
      const plan = ctx.plan as RunPlan;
      const attempts = (plan.attempts || 0) + 1;
      plan.attempts = attempts;
      plan.error = msg;
      plan.lease_until = null;
      // КРАШ шага (не вердикт ОТК) → status=run_fail, чтобы не путать инфра-сбой с «качество не прошло»
      if (attempts >= MAX_STEP_ATTEMPTS) { plan.step = "failed"; await db.from("node_recipes").update({ run_plan: plan, status: "run_fail", updated_at: new Date().toISOString() }).eq("id", ctx.id); }
      else await db.from("node_recipes").update({ run_plan: plan, updated_at: new Date().toISOString() }).eq("id", ctx.id);
    }
    // продолжить цепочку
    try { await internalFetch(`${origin}/api/factory/graph-run/tick`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(recipeId ? { recipe_id: recipeId } : {}), signal: AbortSignal.timeout(20000) }); } catch { /* цепочка прервётся — воскресит ручной запуск */ }
  });

  return NextResponse.json({ claimed: ctx.id, step: ctx.plan.step });
}
