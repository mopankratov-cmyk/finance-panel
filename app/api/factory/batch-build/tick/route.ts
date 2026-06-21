import { NextRequest, NextResponse, after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// V21.2 · тик async-очереди сборки: захватывает batch_build (лиз CAS), обрабатывает ОДНУ пару
// (decompose конкурента → transfer на товар → черновик-рецепт), дёргает следующий тик. Когда пары кончились
// → status=running + /batch (генерация). По образцу graph-run/tick. Платного тут нет (decompose Claude дёшев),
// но лиз бережёт от дублей-черновиков. Всегда JSON.
const LEASE_MS = 90_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function jpost(origin: string, path: string, body: unknown, ms: number): Promise<any> {
  const r = await fetch(`${origin}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
  return r.json().catch(() => ({}));
}

export async function POST(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const origin = req.nextUrl.origin;
  const body = await req.json().catch(() => ({}));
  const buildId = body.build_id ? Number(body.build_id) : undefined;

  const ctx = await claimBuild(db, buildId);
  if (!ctx) return NextResponse.json({ idle: true });

  after(async () => {
    let chain = true;
    try {
      chain = await runBuildStep(db, origin, ctx);
    } catch (e) {
      // краш шага → снять лиз, записать ошибку (без status=failed: следующий тик дообработает оставшееся)
      try { await db.from("batch_builds").update({ lease_until: null, error: String((e as Error)?.message || e).slice(0, 200), updated_at: new Date().toISOString() }).eq("id", ctx.id); } catch { /* */ }
    }
    if (chain) { try { await fetch(`${origin}/api/factory/batch-build/tick`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ build_id: ctx.id }), signal: AbortSignal.timeout(20000) }); } catch { /* воскресит опрос */ } }
  });

  return NextResponse.json({ claimed: ctx.id, cursor: ctx.cursor });
}

// атомарный захват building-сборки со свободным лизом (CAS — как graph-run; wErr → НЕ клеймим вслепую)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function claimBuild(db: SupabaseClient, buildId?: number): Promise<any | null> {
  const nowIso = new Date().toISOString();
  const leaseIso = new Date(Date.now() + LEASE_MS).toISOString();
  let q = db.from("batch_builds").select("*").eq("status", "building").limit(5);
  if (buildId) q = db.from("batch_builds").select("*").eq("id", buildId).limit(1);
  const { data } = await q;
  const rows = (data as Record<string, unknown>[] | null) || [];
  for (const row of rows) {
    if (row.status !== "building") continue;
    if (row.lease_until && new Date(row.lease_until as string).getTime() > Date.now()) continue; // занят
    const { data: won, error: wErr } = await db.from("batch_builds")
      .update({ lease_until: leaseIso, updated_at: nowIso }).eq("id", row.id)
      .or(`lease_until.is.null,lease_until.lt.${nowIso}`).select("id").maybeSingle();
    if (wErr) continue;     // CAS не сработал → не клеймим вслепую (иначе дубли-черновики), воскресит опрос
    if (!won) continue;     // гонку проиграли
    return { ...row, lease_until: leaseIso };
  }
  return null;
}

// ОДИН шаг: обработать пару cursor (decompose→transfer) ЛИБО, если пары кончились, запустить /batch. → chain?
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runBuildStep(db: SupabaseClient, origin: string, ctx: any): Promise<boolean> {
  const id = ctx.id as number;
  const pairs = (Array.isArray(ctx.pairs) ? ctx.pairs : []) as { viral_video_id: number; article: string }[];
  const cursor = Number(ctx.cursor) || 0;
  const built = (Array.isArray(ctx.built_recipe_ids) ? ctx.built_recipe_ids : []) as number[];

  // ── все пары собраны → запускаем генерацию через /batch и закрываем сборку ──
  if (cursor >= pairs.length) {
    if (built.length) {
      try { await jpost(origin, "/api/factory/batch", { recipe_ids: built, budget_usd: Number(ctx.budget_usd) || 40 }, 30000); } catch { /* батч сам воскресит очередь */ }
    }
    await db.from("batch_builds").update({ status: "done", lease_until: null, note: `${built.length} черновиков собрано → запущена генерация (бюджет $${ctx.budget_usd})`, updated_at: new Date().toISOString() }).eq("id", id);
    return false; // цепочка завершена
  }

  // ── обработать ОДНУ пару: decompose конкурента → transfer на товар ──
  const pair = pairs[cursor];
  let recipeId: number | null = null;
  try {
    const dec = await jpost(origin, "/api/factory/decompose", { viral_video_id: pair.viral_video_id }, 55000);
    const nodes = Array.isArray(dec?.nodes) ? dec.nodes : [];
    if (nodes.length) {
      const tr = await jpost(origin, "/api/factory/recipes", { nodes, article: pair.article, niche: ctx.niche, format: dec.format, mode: "audience" }, 25000);
      if (tr?.recipe_id) recipeId = Number(tr.recipe_id);
    }
  } catch { /* пара не вышла — пропускаем, cursor всё равно двигаем (иначе застрянем) */ }

  const nextBuilt = recipeId ? [...built, recipeId] : built;
  await db.from("batch_builds").update({
    cursor: cursor + 1, built_recipe_ids: nextBuilt, lease_until: null,
    note: `собрано ${nextBuilt.length}/${pairs.length}…`, updated_at: new Date().toISOString(),
  }).eq("id", id);
  return true; // продолжить цепочку (следующая пара / запуск генерации)
}
