import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { advanceClaimedRecipe, claimNextRecipe } from "@/lib/factory/graphRun";
import { internalFetch } from "@/lib/internalFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Тик исполнителя графа: захватывает один рецепт (status=running), делает ОДИН шаг, дёргает следующий тик.
// Ошибка шага ретраится до MAX_STEP_ATTEMPTS, затем failed. Всегда JSON.
export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
    const origin = req.nextUrl.origin;
    const body = await req.json().catch(() => ({}));
    const recipeId = body.recipe_id ? Number(body.recipe_id) : undefined;

    const ctx = await claimNextRecipe(db, recipeId);
    if (!ctx) return NextResponse.json({ idle: true });

    const result = await advanceClaimedRecipe(db, origin, ctx);
    if (result.ok && !result.terminal) {
      void internalFetch(`${origin}/api/factory/graph-run/tick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(recipeId ? { recipe_id: recipeId } : {}),
        signal: AbortSignal.timeout(20_000),
      }).catch(() => {
        /* цепочка могла оборваться — её добудит GET/cron */
      });
    }

    return NextResponse.json({
      claimed: ctx.id,
      step: result.step,
      ok: result.ok,
      error: result.error,
      continued: result.ok && !result.terminal,
    });
  } catch (e) {
    return NextResponse.json({ error: "graph-run/tick crash: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
