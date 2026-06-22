import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { internalFetch } from "@/lib/internalFetch";
import type { RunPlan } from "@/lib/factory/graphRun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Vercel Cron · СТРАХОВКА надёжности графа-исполнителя. self-chain тиков (graph-run/tick через Vercel after())
// иногда ОБРЫВАЕТСЯ на долгом render-poll → рецепт висит status=running «готов на VM, но не забанчен» без будильника.
// Этот крон будит ЗАВИСШИЕ рецепты: status=running + активный шаг + updated_at устарел (здоровая цепочка
// обновляет updated_at каждые ~12с на каждом poll-цикле) + лиз свободен/протух. claimNextRecipe в тике ставит
// CAS-лиз → даже если живая цепочка вдруг тикнет параллельно, двойного захвата/двойной оплаты НЕ будет.
// Регистрация в vercel.json: { "path": "/api/factory/graph-run/cron", "schedule": "*/2 * * * *" }.
// Авторизация: Bearer CRON_SECRET (как balances-cron/corpus-cron). Вызывается кроном или кнопкой из кокпита.

const STALE_MS = 90_000;   // > самого долгого здорового «молчания» шага (autofill ~45с) → не будим живые
const MAX_WAKE = 25;       // защита от лавины: за один прогон будим не больше N зависших

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
  // только реально зависшие: активный шаг (не done/failed) + свободный/протухший лиз
  const stuck = rows.filter((r) => {
    const p = r.run_plan;
    return p && p.step !== "done" && p.step !== "failed" && leaseFree(p);
  });

  const origin = req.nextUrl.origin;
  const woken: number[] = [];
  await Promise.all(stuck.map(async (r) => {
    try {
      await internalFetch(`${origin}/api/factory/graph-run/tick`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipe_id: r.id }), signal: AbortSignal.timeout(20000),
      });
      woken.push(r.id);
    } catch { /* следующий прогон крона добьёт */ }
  }));

  // телеметрия: если будим рецепты — значит self-chain оборвалась; durable-сигнал для диагностики надёжности
  if (woken.length) {
    try { await db.from("cf_signals").insert({ event: "graph_resurrect", params: { woken, scanned: rows.length } }); } catch { /* журнал best-effort */ }
    console.warn(`[graph-cron] разбужено зависших рецептов: ${woken.length} (${woken.join(",")})`);
  }

  return NextResponse.json({ ok: true, scanned: rows.length, stuck: stuck.length, woken });
}
