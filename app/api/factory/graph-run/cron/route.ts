import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { wakeStaleRecipes } from "@/lib/factory/graphWatchdog";

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

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const secret = process.env.CRON_SECRET || "";
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const result = await wakeStaleRecipes(db, req.nextUrl.origin, { trigger: "cron" });
  return NextResponse.json({ ok: true, ...result });
}
