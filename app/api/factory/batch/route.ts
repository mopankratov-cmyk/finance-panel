import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { collectBalances } from "@/lib/factory/balances";
import { internalFetch } from "@/lib/internalFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// V21 · Оркестратор батча автопилота: бюджет-гард + смета → ставит рецепты в self-chaining очередь
// с notify=true (прошедшее ОТК уйдёт оператору в Telegram на голос-ревью). R4-варианты (×3) и полная
// openreels-цепочка (ElevenLabs→Creatify→Seedance→Remotion) — ждут V2/V9/V22/V23 (заполнение нод/ассеты).
//   POST { recipe_ids?:[], niche?, count?, budget_usd?, dry_run? }
//   → { enqueued:[], estimated_usd, capped_by_budget, balance_block?, note }
// ⚠️ Без заполнения нод (V2) и openreels-ассетов (V22/V23) рецепты могут падать на сборке — это скелет.

const TOOL_COST: Record<string, number> = { seedance: 0.42, seedance_fast: 0.14, kling: 0.38, kling_pro: 0.5, pika: 0.3, creatify: 1.2, shotstack: 0.08, higgsfield: 0.5, gemini: 0.4 };
const REQUIRED = ["fal", "creatify", "shotstack"]; // движки батча

// смета одного рецепта по нодам (×реген до 3 не учитываем — это потолок, не ожидание)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function estimateRecipe(nodes: any[]): number {
  let sum = 0; let hasVisual = false;
  for (const n of nodes || []) { const t = String(n.tool || "").toLowerCase(); if (TOOL_COST[t]) { sum += TOOL_COST[t]; if (t !== "shotstack") hasVisual = true; } }
  if (hasVisual) sum += TOOL_COST.shotstack; // сборка
  return Math.round(sum * 100) / 100;
}

export async function POST(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const origin = req.nextUrl.origin;
  const b = await req.json().catch(() => ({}));
  const cap = Math.max(1, Number(b.budget_usd) || 40);
  const count = Math.min(30, Math.max(1, Number(b.count) || 5));
  const dryRun = b.dry_run === true;

  // 1) бюджет-гард по балансам (раз на батч; collectBalances живой ~9с — ОК для одного вызова)
  let balanceUnknown: string[] = []; // баланс null (нет FAL admin-ключа / гео) → гард не смог проверить
  try {
    const balances = await collectBalances(db, { throttleMs: 60000 });
    const low = balances.filter((s) => REQUIRED.includes(s.service) && s.low === true).map((s) => s.service);
    if (low.length) return NextResponse.json({ ok: false, balance_block: low, error: `Низкий баланс: ${low.join(", ")} — пополни или подними порог. Батч не запущен.` });
    balanceUnknown = balances.filter((s) => REQUIRED.includes(s.service) && s.balance == null).map((s) => s.service);
  } catch { /* балансы не определились → не блокируем по неопределённости */ }

  // 2) резолв рецептов: явные id ИЛИ черновики ниши
  let recipeIds: number[] = Array.isArray(b.recipe_ids) ? b.recipe_ids.map((x: unknown) => Number(x)).filter(Boolean) : [];
  if (!recipeIds.length) {
    let q = db.from("node_recipes").select("id,niche").eq("status", "draft").order("id", { ascending: false }).limit(count);
    if (b.niche) q = q.eq("niche", b.niche);
    const { data } = await q;
    recipeIds = ((data as { id: number }[] | null) || []).map((r) => r.id);
  }
  recipeIds = recipeIds.slice(0, count);
  if (!recipeIds.length) return NextResponse.json({ ok: false, error: "нет рецептов-черновиков для батча (создай в студии или передай recipe_ids)" });

  // 3) смета по нодам + отсечка по бюджету
  const enqueued: number[] = []; let spent = 0; let cappedByBudget = false;
  for (const rid of recipeIds) {
    const { data: nodes } = await db.from("node_recipe_nodes").select("tool").eq("recipe_id", rid);
    const est = estimateRecipe((nodes as Record<string, unknown>[] | null) || []);
    if (spent + est > cap) { cappedByBudget = true; break; }
    spent = Math.round((spent + est) * 100) / 100;
    if (!dryRun) {
      try { await internalFetch(`${origin}/api/factory/graph-run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipe_id: rid, notify: true, restart: true }), signal: AbortSignal.timeout(20000) }); } catch { /* очередь воскресит */ }
    }
    enqueued.push(rid);
  }

  return NextResponse.json({
    ok: true, dry_run: dryRun, enqueued, estimated_usd: spent, budget_usd: cap, capped_by_budget: cappedByBudget,
    balance_unknown: balanceUnknown, // ⚠ по этим сервисам баланс не проверен (нет ключа/гео) — гард не гарантирует
    note: "Прошедшее ОТК уйдёт в Telegram на ревью (notify=true). R4-варианты ×3 и openreels-ассеты — после V2/V9/V22/V23." + (balanceUnknown.length ? ` ⚠ Баланс не проверен: ${balanceUnknown.join(", ")}.` : ""),
  });
}
