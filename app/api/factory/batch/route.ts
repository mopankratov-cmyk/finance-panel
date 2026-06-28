import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { collectBalances } from "@/lib/factory/balances";
import { internalFetch } from "@/lib/internalFetch";
import { loadImprovementSnapshot, type ImprovementBatchPlan } from "@/lib/factory/improvementLoop";
import { buildRunPlan, makeRunId } from "@/lib/factory/graphRun";
import type { RunPlan } from "@/lib/factory/graphTypes";
import { loadSourceReadiness, type SourceReadinessTier } from "@/lib/factory/sourceReadiness";
import { applyReelsBrainPatternToPlan, pickReelsBrainPattern } from "@/lib/factory/reelsBrainPicker";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const DRAFT_LOOKUP_LIMIT = 50;

// V21 · Оркестратор батча автопилота: бюджет-гард + смета → запускает рецепты через graph-run runner
// с notify=true (прошедшее ОТК уйдёт оператору в Telegram на голос-ревью). R4-варианты (×3) и полная
// openreels-цепочка (ElevenLabs→Creatify→Seedance→Remotion) — ждут V2/V9/V22/V23 (заполнение нод/ассеты).
//   POST { recipe_ids?:[], niche?, count?, budget_usd?, dry_run? }
//   → { requested, selected_recipes, enqueued:[], estimated_usd, capped_by_budget, balance_block?, note }
// ⚠️ Без заполнения нод (V2) и openreels-ассетов (V22/V23) рецепты могут падать на сборке — это скелет.

const TOOL_COST: Record<string, number> = { seedance: 0.42, seedance_fast: 0.14, kling: 0.38, kling_pro: 0.5, pika: 0.3, creatify: 1.2, shotstack: 0.08, higgsfield: 0.5, gemini: 0.4, elevenlabs: 0.1 };
const REQUIRED = ["fal", "creatify", "shotstack"]; // движки батча

const DEFAULT_RECIPE_COST = 3.2; // CONSERVATIVE: autofill может выбрать дороже (creatify+seedance×4) + реген ×3 → бюджет-гард не должен недооценивать черновики
const REGEN_FACTOR = 3;          // = MAX_RENDERS: бюджет-гард по АБСОЛЮТНОМУ потолку (даже если КАЖДЫЙ рецепт реген-нётся ×3) → сумма ≤ budget = ЖЁСТКИЙ кап, автопилот физически не перерасходует; типовую смету показываем отдельно
const OPEN_LEARNING_GATE = { ready: true, reason: "learning gate not requested", current_feedback: 0, required_feedback: 0 };
const PROVIDER_BLOCK_LOOKBACK_MS = 6 * 60 * 60 * 1000;
const SOURCE_TIER_RANK: Record<SourceReadinessTier, number> = { prepared: 3, real: 2, wb: 1, none: 0 };

// смета одного рецепта по нодам (×реген до 3 не учитываем — это потолок, не ожидание).
// V21: рецепт-черновик конфигурируется §17 уже В ОЧЕРЕДИ → tool может ещё не стоять. Если по нодам цены нет
// (нули) — берём conservative-оценку по числу генеративных нод, иначе бюджет-гард не сдержит черновики.

function estimateRecipe(nodes: any[]): number {
  let sum = 0; let hasVisual = false; let priced = 0;
  const gen = (nodes || []).filter((n) => { const t = String(n.node_type || n.slot || "").toLowerCase(); return !["captions", "caption", "music", "sound", "transition"].includes(t); }).length;
  for (const n of nodes || []) { const t = String(n.tool || "").toLowerCase(); if (TOOL_COST[t]) { sum += TOOL_COST[t]; priced++; if (t !== "shotstack") hasVisual = true; } }
  if (hasVisual) sum += TOOL_COST.shotstack; // сборка
  if (!priced && gen) return Math.min(DEFAULT_RECIPE_COST, gen * 0.5); // черновик без движков → оценка по нодам
  return Math.round(sum * 100) / 100;
}

function sourceTierRank(tier: SourceReadinessTier | null | undefined): number {
  return SOURCE_TIER_RANK[tier || "none"] || 0;
}

async function enqueueGraphRun(db: any, rid: number, meta: { batch_run_id: string; batch_role: string; change_axis: string }) {
  const { data: nodes } = await db
    .from("node_recipe_nodes")
    .select("ordinal,slot,node_type,tool,prompt,params,asset_url,duration_sec,agent_suggestion")
    .eq("recipe_id", rid)
    .order("ordinal");
  const rows = (nodes as Record<string, unknown>[] | null) || [];
  if (!rows.length) return { ok: false, error: "у рецепта нет нод" };
  const plan = buildRunPlan(rows) as RunPlan;
  plan.run_id = makeRunId(rid);
  plan.batch_run_id = meta.batch_run_id;
  plan.batch_role = meta.batch_role === "control" || meta.batch_role === "experiment" ? meta.batch_role : "none";
  plan.change_axis = ["none", "hook_angle", "proof_density", "cta_shape", "format"].includes(meta.change_axis) ? meta.change_axis as RunPlan["change_axis"] : "none";
  plan.execution_log = [];
  plan.warnings = [];
  plan.notify = true;
  plan.step = "autofill";
  try {
    const { data: recipeRows } = await db.from("node_recipes").select("niche").eq("id", rid).limit(1);
    const recipeNiche = String((recipeRows as { niche?: string | null }[] | null)?.[0]?.niche || "").trim();
    const pattern = await pickReelsBrainPattern(db, recipeNiche, `${meta.batch_run_id}:${rid}:${meta.change_axis}`);
    if (applyReelsBrainPatternToPlan(plan, pattern)) {
      plan.warnings = (plan.warnings || []).filter((warning) => !String(warning).startsWith("reels-brain"));
    }
  } catch {
    plan.warnings = [...(plan.warnings || []), "reels-brain pattern picker unavailable; enqueue continues fail-open"];
  }
  const { error } = await db.from("node_recipes").update({
    run_plan: plan,
    status: "running",
    otk_verdict: null,
    otk_score: null,
    output_url: null,
    render_id: null,
    updated_at: new Date().toISOString(),
  }).eq("id", rid);
  if (error) return { ok: false, error: error.message };
  return { ok: true, run_id: plan.run_id };
}

function textFromUnknown(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value || {});
  } catch {
    return String(value || "");
  }
}

function providerBlockFromText(raw: string): string | null {
  const text = raw.toLowerCase();
  if (!/balance|exhausted|user is locked|provider balance stop|пополни|баланс/.test(text)) return null;
  if (/fal|seedance|kling|pika/.test(text)) return "fal";
  if (/creatify/.test(text)) return "creatify";
  if (/shotstack/.test(text)) return "shotstack";
  return "provider";
}

async function recentProviderBalanceBlocks(db: any, niche: string | null): Promise<string[]> {
  try {
    const since = new Date(Date.now() - PROVIDER_BLOCK_LOOKBACK_MS).toISOString();
    let q = db
      .from("node_recipes")
      .select("id,niche,status,run_plan,otk_notes,updated_at")
      .gte("updated_at", since)
      .order("updated_at", { ascending: false })
      .limit(80);
    if (niche) q = q.eq("niche", niche);
    const { data } = await q;
    const found = new Set<string>();
    for (const row of (data || []) as Record<string, unknown>[]) {
      const service = providerBlockFromText(textFromUnknown(row));
      if (service) found.add(service);
    }
    return [...found].filter((service) => REQUIRED.includes(service));
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  try {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const origin = req.nextUrl.origin;
  const b = await req.json().catch(() => ({}));
  const cap = Math.max(1, Number(b.budget_usd) || 40);
  const count = Math.min(30, Math.max(1, Number(b.count) || 5));
  const dryRun = b.dry_run === true;
  const requireFullBatch = b.require_full_batch === true;
  const requireLearningGate = b.require_learning_gate === true;
  const requireStrongSource = b.require_strong_source === true;
  const requestedNiche = String(b.niche || "").trim() || null;
  const seriesAfter = String(b.series_after || "").trim() || null;
  const batchRunId = `batch_${Date.now()}_${randomUUID().slice(0, 8)}`;
  let learningGate = OPEN_LEARNING_GATE;
  let learningGateWarning = "";
  let batchPlan: ImprovementBatchPlan | null = null;

  if (requireLearningGate) {
    try {
      const snapshot = await loadImprovementSnapshot(db, { niche: requestedNiche, target_runs: 50, batch_size: Math.max(2, Math.min(10, count)), series_after: seriesAfter });
      learningGate = snapshot.next_batch_gate || { ready: true, reason: "learning gate unavailable in snapshot; fail-open", current_feedback: 0, required_feedback: 0 };
      batchPlan = snapshot.batch_plan || null;
    } catch (e) {
      learningGate = { ready: true, reason: "learning gate unavailable; fail-open", current_feedback: 0, required_feedback: 0 };
      learningGateWarning = String((e as Error)?.message || e).slice(0, 120);
    }
  }

  // 1) бюджет-гард по балансам (раз на батч; collectBalances живой ~9с — ОК для одного вызова)
  let balanceUnknown: string[] = []; // баланс null (нет FAL admin-ключа / гео) → гард не смог проверить
  let providerBlock: string[] = [];
  try {
    const balances = await collectBalances(db, { throttleMs: 60000 });
    const low = balances.filter((s) => REQUIRED.includes(s.service) && s.low === true).map((s) => s.service);
    if (low.length) return NextResponse.json({ ok: false, balance_block: low, error: `Низкий баланс: ${low.join(", ")} — пополни или подними порог. Батч не запущен.` }, { status: 409 });
    balanceUnknown = balances.filter((s) => REQUIRED.includes(s.service) && s.balance == null).map((s) => s.service);
  } catch { /* балансы не определились → не блокируем по неопределённости */ }
  providerBlock = await recentProviderBalanceBlocks(db, requestedNiche);

  // 2) резолв рецептов: явные id ИЛИ черновики ниши
  let recipeIds: number[] = Array.isArray(b.recipe_ids) ? b.recipe_ids.map((x: unknown) => Number(x)).filter(Boolean) : [];
  let selectedRecipes: { id: number; niche: string | null; article: string | null }[] = [];
  if (!recipeIds.length) {
    let q = db.from("node_recipes").select("id,niche,article").eq("status", "draft").order("id", { ascending: false }).limit(Math.max(count * 5, DRAFT_LOOKUP_LIMIT));
    if (requestedNiche) q = q.eq("niche", requestedNiche);
    const { data } = await q;
    const draftPool = ((data as { id: number; niche?: string | null; article?: string | null }[] | null) || [])
      .map((r) => ({ id: r.id, niche: r.niche || null, article: r.article || null }));
    const sourceInfoPool = await loadSourceReadiness(db, draftPool.map((row) => row.article || ""));
    selectedRecipes = draftPool
      .filter((row) => !!row.article && sourceInfoPool.get(String(row.article))?.ready)
      .sort((a, b) => sourceTierRank(sourceInfoPool.get(String(b.article || ""))?.tier) - sourceTierRank(sourceInfoPool.get(String(a.article || ""))?.tier))
      .slice(0, count);
    recipeIds = selectedRecipes.map((r) => r.id);
  }
  recipeIds = recipeIds.slice(0, count);
  if (!selectedRecipes.length && recipeIds.length) {
    const { data } = await db.from("node_recipes").select("id,niche,article").in("id", recipeIds);
    const byId = new Map(((data as { id: number; niche?: string | null; article?: string | null }[] | null) || [])
      .map((r) => [r.id, { id: r.id, niche: r.niche || null, article: r.article || null }]));
    selectedRecipes = recipeIds.map((id) => byId.get(id) || { id, niche: null, article: null });
  } else {
    selectedRecipes = selectedRecipes.filter((r) => recipeIds.includes(r.id));
  }
  const availableDrafts = selectedRecipes.length;
  const missingDrafts = Math.max(0, count - availableDrafts);
  const sourceReadiness = await loadSourceReadiness(db, selectedRecipes.map((row) => row.article || ""));
  const sourceReadyArticles = new Set(Array.from(sourceReadiness.entries()).filter(([, item]) => item.ready).map(([article]) => article));
  const sourceReadyRecipeIds = selectedRecipes
    .filter((row) => !!row.article && sourceReadyArticles.has(String(row.article)))
    .map((row) => row.id);
  const sourceReadyDrafts = sourceReadyRecipeIds.length;
  const sourceTierCounts = Array.from(sourceReadiness.values()).reduce<Record<SourceReadinessTier, number>>((acc, item) => {
    acc[item.tier] = (acc[item.tier] || 0) + 1;
    return acc;
  }, { prepared: 0, real: 0, wb: 0, none: 0 });
  const strongSourceDrafts = selectedRecipes.filter((row) => {
    const tier = sourceReadiness.get(String(row.article || ""))?.tier || "none";
    return tier === "prepared" || tier === "real";
  }).length;
  const wbOnlyDrafts = sourceTierCounts.wb || 0;
  const missingSourceDrafts = Math.max(0, count - sourceReadyDrafts);
  const providerReady = providerBlock.length === 0;
  if (!recipeIds.length) return NextResponse.json({
    ok: false,
    batch_run_id: null,
    requested: { niche: requestedNiche, count, budget_usd: cap, series_after: seriesAfter },
    preflight: {
      ready: false,
      requested_count: count,
      available_drafts: 0,
      missing_drafts: count,
      source_ready_drafts: 0,
      missing_source_drafts: count,
      strong_source_drafts: 0,
      wb_only_drafts: 0,
      source_tiers: { prepared: 0, real: 0, wb: 0, none: 0 },
      budget_fit_count: 0,
      provider_ready: providerReady,
    },
    learning_gate: learningGate,
    batch_plan: batchPlan,
    selected_recipes: [],
    dry_run: true,
    enqueued: [],
    estimated_usd: 0,
    worst_case_usd: 0,
    budget_usd: cap,
    capped_by_budget: false,
    balance_unknown: balanceUnknown,
    provider_block: providerBlock,
    next_action: providerReady ? { type: "prepare_drafts", route: "/api/factory/prepare-drafts", count, niche: requestedNiche } : null,
    error: providerReady
      ? "нет рецептов-черновиков для батча (создай в студии или передай recipe_ids)"
      : `Пятёрка не запущена: ${providerBlock.join(", ")} недавно вернул balance/access stop. Пополни провайдера и повтори preflight.`,
  }, { status: 409 });

  // 3) смета по нодам + отсечка по бюджету. Гард по WORST-CASE (est×REGEN_FACTOR) — иначе реген-петля
  // (до ×3 рендеров) перерасходует на unattended-автопилоте. spent — типовая смета для показа.
  const plannedRecipeIds: number[] = []; let spent = 0; let spentWorst = 0; let cappedByBudget = false;
  const qualitySourceRecipeIds = requireStrongSource
    ? selectedRecipes
      .filter((row) => {
        const tier = sourceReadiness.get(String(row.article || ""))?.tier || "none";
        return tier === "prepared" || tier === "real";
      })
      .map((row) => row.id)
    : sourceReadyRecipeIds;
  for (const rid of recipeIds.filter((id) => qualitySourceRecipeIds.includes(id))) {
    const { data: nodes } = await db.from("node_recipe_nodes").select("tool,node_type,slot").eq("recipe_id", rid);
    const est = estimateRecipe((nodes as Record<string, unknown>[] | null) || []);
    if (spentWorst + est * REGEN_FACTOR > cap) { cappedByBudget = true; break; }
    spentWorst = Math.round((spentWorst + est * REGEN_FACTOR) * 100) / 100;
    spent = Math.round((spent + est) * 100) / 100;
    plannedRecipeIds.push(rid);
  }
  const preflight = {
    ready: plannedRecipeIds.length >= count && !cappedByBudget && sourceReadyDrafts >= count && (!requireStrongSource || strongSourceDrafts >= count) && providerReady && (!requireLearningGate || learningGate.ready),
    requested_count: count,
    available_drafts: availableDrafts,
    missing_drafts: missingDrafts,
    source_ready_drafts: sourceReadyDrafts,
    missing_source_drafts: missingSourceDrafts,
    strong_source_drafts: strongSourceDrafts,
    wb_only_drafts: wbOnlyDrafts,
    source_tiers: sourceTierCounts,
    require_strong_source: requireStrongSource,
    budget_fit_count: plannedRecipeIds.length,
    provider_ready: providerReady,
  };
  const wbOnlyArticle = selectedRecipes.find((row) => (sourceReadiness.get(String(row.article || ""))?.tier || "none") === "wb")?.article || null;
  const sourcePrepNextAction = wbOnlyDrafts > 0 && strongSourceDrafts < count
    ? { type: "prepare_product", route: "/api/factory/prepare-product", article: wbOnlyArticle, count: Math.min(2, wbOnlyDrafts), reason: "batch has WB-only sources; prepared product frames should lift OTK pass-rate" }
    : null;
  const controlCount = Math.max(1, Math.min(count, Number(batchPlan?.control_count) || Math.min(2, count)));
  const primaryAxis = ["hook_angle", "proof_density", "cta_shape", "format"].includes(String(batchPlan?.primary_change_axis || ""))
    ? String(batchPlan?.primary_change_axis)
    : "hook_angle";
  const batchMetaFor = (rid: number, idx: number) => {
    const role = idx < controlCount ? "control" : "experiment";
    return { id: rid, batch_role: role, change_axis: role === "control" ? "none" : primaryAxis };
  };
  const selectedById = new Map(selectedRecipes.map((r) => [r.id, r]));
  const selectedWithBatchMeta = (ids: number[]) => ids
    .map((id, idx) => {
      const r = selectedById.get(id) || { id, niche: null, article: null };
      return { ...r, ...batchMetaFor(id, idx) };
    });
  if (requireLearningGate && !dryRun && !learningGate.ready) {
    return NextResponse.json({
      ok: false,
      batch_run_id: null,
      requested: { niche: requestedNiche, count, budget_usd: cap, series_after: seriesAfter },
      preflight,
      learning_gate: learningGate,
      batch_plan: batchPlan,
      selected_recipes: selectedWithBatchMeta(plannedRecipeIds),
      dry_run: true,
      enqueued: [],
      estimated_usd: spent,
      worst_case_usd: spentWorst,
      budget_usd: cap,
      capped_by_budget: cappedByBudget,
      balance_unknown: balanceUnknown,
      provider_block: providerBlock,
      error: learningGate.reason || "Пятёрка не запущена: learning gate не готов.",
    }, { status: 409 });
  }
  if (requireFullBatch && !dryRun && providerBlock.length) {
    return NextResponse.json({
      ok: false,
      batch_run_id: null,
      requested: { niche: requestedNiche, count, budget_usd: cap, series_after: seriesAfter },
      preflight,
      learning_gate: learningGate,
      batch_plan: batchPlan,
      selected_recipes: selectedWithBatchMeta(plannedRecipeIds),
      dry_run: true,
      enqueued: [],
      estimated_usd: spent,
      worst_case_usd: spentWorst,
      budget_usd: cap,
      capped_by_budget: cappedByBudget,
      balance_unknown: balanceUnknown,
      provider_block: providerBlock,
      error: `Пятёрка не запущена: ${providerBlock.join(", ")} недавно вернул balance/access stop. Пополни провайдера и повтори preflight.`,
    }, { status: 409 });
  }
  if (requireFullBatch && !dryRun && !preflight.ready) {
    return NextResponse.json({
      ok: false,
      batch_run_id: null,
      requested: { niche: requestedNiche, count, budget_usd: cap, series_after: seriesAfter },
      preflight,
      learning_gate: learningGate,
      batch_plan: batchPlan,
      selected_recipes: selectedWithBatchMeta(plannedRecipeIds),
      dry_run: true,
      enqueued: [],
      estimated_usd: spent,
      worst_case_usd: spentWorst,
      budget_usd: cap,
      capped_by_budget: cappedByBudget,
      balance_unknown: balanceUnknown,
      provider_block: providerBlock,
      next_action: requireStrongSource && strongSourceDrafts < count && sourcePrepNextAction
        ? sourcePrepNextAction
        : preflight.missing_drafts > 0 || preflight.missing_source_drafts > 0 ? { type: "prepare_drafts", route: "/api/factory/prepare-drafts", count, niche: requestedNiche } : sourcePrepNextAction,
      error: preflight.missing_drafts > 0
        ? `Пятёрка не запущена: не хватает ${preflight.missing_drafts} draft-рецептов.`
        : requireStrongSource && strongSourceDrafts < count
          ? `Пятёрка не запущена: quality-first требует prepared/real source, сейчас ${strongSourceDrafts}/${count}.`
        : preflight.missing_source_drafts > 0
          ? `Пятёрка не запущена: не хватает ${preflight.missing_source_drafts} source-ready draft-рецептов.`
        : "Пятёрка не запущена: бюджет не покрывает полный batch.",
    }, { status: 409 });
  }
  const enqueued: number[] = [];
  const enqueueErrors: string[] = [];
  if (!dryRun) {
    for (const [idx, rid] of plannedRecipeIds.entries()) {
      // Быстрый enqueue: не ждём первый /graph-run/tick внутри batch request, иначе 5 рецептов легко дают platform timeout.
      const batchMeta = batchMetaFor(rid, idx);
      const enq = await enqueueGraphRun(db, rid, { batch_run_id: batchRunId, batch_role: batchMeta.batch_role, change_axis: batchMeta.change_axis });
      if (enq.ok) enqueued.push(rid);
      else enqueueErrors.push(`#${rid}: ${String(enq.error || "enqueue failed").slice(0, 100)}`);
    }
    try { await internalFetch(`${origin}/api/factory/graph-run/tick`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}), signal: AbortSignal.timeout(2500) }); } catch { /* cron/watchdog продолжит */ }
  } else enqueued.push(...plannedRecipeIds);

  return NextResponse.json({
    ok: dryRun || enqueued.length > 0,
    batch_run_id: batchRunId,
    requested: { niche: requestedNiche, count, budget_usd: cap, series_after: seriesAfter },
    preflight,
    learning_gate: learningGate,
    batch_plan: batchPlan,
    selected_recipes: selectedWithBatchMeta(enqueued),
    dry_run: dryRun, enqueued, estimated_usd: spent, worst_case_usd: spentWorst, budget_usd: cap, capped_by_budget: cappedByBudget,
    balance_unknown: balanceUnknown, // ⚠ по этим сервисам баланс не проверен (нет ключа/гео) — гард не гарантирует
    provider_block: providerBlock,
    next_action: sourcePrepNextAction,
    warnings: [...(learningGateWarning ? [`learning gate fail-open: ${learningGateWarning}`] : []), ...(sourcePrepNextAction ? ["source-prep recommended: batch contains WB-only sources"] : []), ...enqueueErrors],
    note: `Бюджет-гард по worst-case (реген до ×3): уложились в $${cap}, типовая трата ≈ $${spent}, потолок ≈ $${spentWorst}. Прошедшее ОТК → Telegram (notify).` + (balanceUnknown.length ? ` ⚠ Баланс не проверен: ${balanceUnknown.join(", ")}.` : ""),
  });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      batch_run_id: null,
      requested: { niche: null, count: 0, budget_usd: 0 },
      preflight: { ready: false, requested_count: 0, available_drafts: 0, missing_drafts: 0, budget_fit_count: 0 },
      learning_gate: { ready: true, reason: "batch crashed before learning gate", current_feedback: 0, required_feedback: 0 },
      selected_recipes: [],
      dry_run: true,
      enqueued: [],
      estimated_usd: 0,
      worst_case_usd: 0,
      budget_usd: 0,
      capped_by_budget: true,
      balance_unknown: [],
      error: "batch crash: " + String((e as Error)?.message || e).slice(0, 160),
    }, { status: 500 });
  }
}
