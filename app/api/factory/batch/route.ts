import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { collectBalances } from "@/lib/factory/balances";
import { internalFetch } from "@/lib/internalFetch";
import { REGEN_FACTOR, estimateRunCost } from "@/lib/factory/costEstimate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// V21 · Оркестратор батча автопилота: бюджет-гард + смета → запускает рецепты через graph-run runner
// с notify=true (прошедшее ОТК уйдёт оператору в Telegram на голос-ревью). R4-варианты (×3) и полная
// openreels-цепочка (ElevenLabs→Creatify→Seedance→Remotion) — ждут V2/V9/V22/V23 (заполнение нод/ассеты).
//   POST { recipe_ids?:[], niche?, count?, budget_usd?, dry_run? }
//   → { enqueued:[], estimated_usd, capped_by_budget, balance_block?, note }
// ⚠️ Без заполнения нод (V2) и openreels-ассетов (V22/V23) рецепты могут падать на сборке — это скелет.

const REQUIRED = ["fal", "creatify", "shotstack"]; // движки батча

export async function POST(req: NextRequest) {
  try {
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
    const est = estimateRunCost((nodes as Record<string, unknown>[] | null) || []).typical_usd;
    if (spentWorst + est * REGEN_FACTOR > cap) { cappedByBudget = true; break; }
    spentWorst = Math.round((spentWorst + est * REGEN_FACTOR) * 100) / 100;
    spent = Math.round((spent + est) * 100) / 100;
    if (!dryRun) {
      // autofill:true → рецепт сам сконфигурируется (§17 + бренд-кит) первым graph-run шагом, затем генерация→ОТК→банк→Telegram
      try { await internalFetch(`${origin}/api/factory/graph-run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipe_id: rid, notify: true, restart: true, autofill: true }), signal: AbortSignal.timeout(20000) }); } catch { /* tick/cron fallback подхватит */ }
    }
    enqueued.push(rid);
  }

  return NextResponse.json({
    ok: true, dry_run: dryRun, enqueued, estimated_usd: spent, worst_case_usd: spentWorst, budget_usd: cap, capped_by_budget: cappedByBudget,
    balance_unknown: balanceUnknown, // ⚠ по этим сервисам баланс не проверен (нет ключа/гео) — гард не гарантирует
    note: `Бюджет-гард по worst-case (реген до ×3): уложились в $${cap}, типовая трата ≈ $${spent}, потолок ≈ $${spentWorst}. Прошедшее ОТК → Telegram (notify).` + (balanceUnknown.length ? ` ⚠ Баланс не проверен: ${balanceUnknown.join(", ")}.` : ""),
  });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      dry_run: true,
      enqueued: [],
      estimated_usd: 0,
      worst_case_usd: 0,
      budget_usd: 0,
      capped_by_budget: true,
      balance_unknown: [],
      error: "пакетный запуск упал: " + String((e as Error)?.message || e).slice(0, 160),
    }, { status: 500 });
  }
}
