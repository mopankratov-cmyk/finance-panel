import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { reelsBrainTaskForCronTick } from "@/lib/factory/reelsBrainCronGate";
import { wakeStaleRecipes } from "@/lib/factory/graphWatchdog";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
const CRON_MAX_WAKE = 5;

// Vercel Cron · СТРАХОВКА надёжности графа-исполнителя. self-chain тиков (graph-run/tick) делает работу в
// Vercel after() — а after() НЕ исполняется надёжно при server-to-server вызове (крон→internalFetch→tick):
// тик отвечает, but after() с runRecipeStep не докручивается → рецепт висит status=running, pollCount не растёт
// (диагностировано вживую: крон звал тик, graph_resurrect писался, а шаг не исполнялся). Поэтому здесь крон
// гоняет runRecipeStep СИНХРОННО (await в своём хендлере) — гарантированно, без зависимости от after().
// Будит зависшие: status=running + активный шаг + updated_at>90с (здоровая цепочка освежает ~12с) + лиз свободен.
// claimNextRecipe ставит CAS-лиз → нет двойного захвата с живой цепочкой. Один шаг на рецепт за прогон;
// 2-минутный такт доводит рецепт по шагам (render-poll→otk→bank→done). cf_signals graph_resurrect — телеметрия.
// vercel.json: { "path": "/api/factory/graph-run/cron", "schedule": "*/2 * * * *" }. Auth: Bearer CRON_SECRET.

export async function GET(req: NextRequest) {
  try {
    const auth = req.headers.get("authorization") || "";
    const secret = process.env.CRON_SECRET || "";
    if (secret && auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
    const reelsBrainTask = reelsBrainTaskForCronTick();
    const result = await wakeStaleRecipes(db, req.nextUrl.origin, { trigger: "cron", maxWake: CRON_MAX_WAKE });
    const reelsBrain = reelsBrainTask
      ? await internalFetch(`${req.nextUrl.origin}/api/factory/jobs/reels-brain-cron?task=${reelsBrainTask}`, {
        method: "GET",
        signal: AbortSignal.timeout(110000),
      }).then(async (res) => ({
        ok: res.ok,
        status: res.status,
        task: reelsBrainTask,
        result: await res.json().catch(() => ({})),
      })).catch((e) => ({
        ok: false,
        task: reelsBrainTask,
        error: String((e as Error)?.message || e).slice(0, 160),
      }))
      : { ok: true, skipped: true, reason: "not a reels-brain tick minute" };
    return NextResponse.json({ ok: true, ...result, reels_brain: reelsBrain });
  } catch (e) {
    return NextResponse.json({ error: "graph-run/cron crash: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
