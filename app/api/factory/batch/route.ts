import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { collectBalances } from "@/lib/factory/balances";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// V21 · Оркестратор батча автопилота: бюджет-гард + смета → ставит рецепты в self-chaining очередь
// с notify=true (прошедшее ОТК уйдёт оператору в Telegram на голос-ревью). R4-варианты (×3) и полная
// openreels-цепочка (ElevenLabs→Creatify→Seedance→Remotion) — ждут V2/V9/V22/V23 (заполнение нод/ассеты).
//   POST { recipe_ids?:[], niche?, count?, budget_usd?, dry_run? }
//   → { enqueued:[], estimated_usd, capped_by_budget, balance_block?, note }
// ⚠️ Без заполнения нод (V2) и openreels-ассетов (V22/V23) рецепты могут падать на сборке — это скелет.

const TOOL_COST: Record<string, number> = { seedance: 0.42, seedance_fast: 0.14, kling: 0.38, kling_pro: 0.5, pika: 0.3, creatify: 1.2, shotstack: 0.08, higgsfield: 0.5, gemini: 0.4, elevenlabs: 0.1 };
const REQUIRED = ["fal", "creatify", "shotstack"]; // движки батча

const DEFAULT_RECIPE_COST = 3.2; // CONSERVATIVE: autofill может выбрать дороже (creatify+seedance×4) + реген ×3 → бюджет-гард не должен недооценивать черновики
const REGEN_FACTOR = 3;          // = MAX_RENDERS: бюджет-гард по АБСОЛЮТНОМУ потолку (даже если КАЖДЫЙ рецепт реген-нётся ×3) → сумма ≤ budget = ЖЁСТКИЙ кап, автопилот физически не перерасходует; типовую смету показываем отдельно

// смета одного рецепта по нодам (×реген до 3 не учитываем — это потолок, не ожидание).
// V21: рецепт-черновик конфигурируется §17 уже В ОЧЕРЕДИ → tool может ещё не стоять. Если по нодам цены нет
// (нули) — берём conservative-оценку по числу генеративных нод, иначе бюджет-гард не сдержит черновики.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function estimateRecipe(nodes: any[]): number {
  let sum = 0; let hasVisual = false; let priced = 0;
  const gen = (nodes || []).filter((n) => { const t = String(n.node_type || n.slot || "").toLowerCase(); return !["captions", "caption", "music", "sound", "transition"].includes(t); }).length;
  for (const n of nodes || []) { const t = String(n.tool || "").toLowerCase(); if (TOOL_COST[t]) { sum += TOOL_COST[t]; priced++; if (t !== "shotstack") hasVisual = true; } }
  if (hasVisual) sum += TOOL_COST.shotstack; // сборка
  if (!priced && gen) return Math.min(DEFAULT_RECIPE_COST, gen * 0.5); // черновик без движков → оценка по нодам
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

  // 3) смета по нодам + отсечка по бюджету. Гард по WORST-CASE (est×REGEN_FACTOR) — иначе реген-петля
  // (до ×3 рендеров) перерасходует на unattended-автопилоте. spent — типовая смета для показа.
  const enqueued: number[] = []; let spent = 0; let spentWorst = 0; let cappedByBudget = false;
  for (const rid of recipeIds) {
    const { data: nodes } = await db.from("node_recipe_nodes").select("tool,node_type,slot").eq("recipe_id", rid);
    const est = estimateRecipe((nodes as Record<string, unknown>[] | null) || []);
    if (spentWorst + est * REGEN_FACTOR > cap) { cappedByBudget = true; break; }
    spentWorst = Math.round((spentWorst + est * REGEN_FACTOR) * 100) / 100;
    spent = Math.round((spent + est) * 100) / 100;
    if (!dryRun) {
      // autofill:true → рецепт сам сконфигурируется (§17 + бренд-кит) первым шагом очереди, затем генерация→ОТК→банк→Telegram
      try { await fetch(`${origin}/api/factory/graph-run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipe_id: rid, notify: true, restart: true, autofill: true }), signal: AbortSignal.timeout(20000) }); } catch { /* очередь воскресит */ }
    }
    enqueued.push(rid);
  }

  return NextResponse.json({
    ok: true, dry_run: dryRun, enqueued, estimated_usd: spent, worst_case_usd: spentWorst, budget_usd: cap, capped_by_budget: cappedByBudget,
    balance_unknown: balanceUnknown, // ⚠ по этим сервисам баланс не проверен (нет ключа/гео) — гард не гарантирует
    note: `Бюджет-гард по worst-case (реген до ×3): уложились в $${cap}, типовая трата ≈ $${spent}, потолок ≈ $${spentWorst}. Прошедшее ОТК → Telegram (notify).` + (balanceUnknown.length ? ` ⚠ Баланс не проверен: ${balanceUnknown.join(", ")}.` : ""),
  });
}
