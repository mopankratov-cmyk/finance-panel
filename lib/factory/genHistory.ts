// V20 · Память итераций: лог КАЖДОЙ попытки генерации в generation_history (миграция 20260621_*).
// Best-effort: любые ошибки глотаем (таблица может быть не применена) — конвейер не падает.
// Цель — субстрат петли обучения: «ролик → 3 итерации → починили → ОТК 4→6 → финал».

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export interface GenHistoryRow {
  parent_id?: number | null;     // от какой версии (реген/вариант/итерация)
  recipe_id?: number | null;
  node_id?: number | null;
  variant_idx?: number | null;   // R4: какой из N вариантов
  attempt?: number;              // V3/V4: номер попытки реген-петли
  tool?: string | null;
  engine?: string | null;
  node_type?: string | null;
  prompt?: string | null;

  params?: any;
  input_url?: string | null;
  output_url?: string | null;
  otk_score?: number | null;

  otk_axes?: any;
  otk_verdict?: string | null;
  artifact_ok?: boolean | null;
  status?: string;               // generated|artifact_fail|warning|otk_pass|otk_fail(legacy read-only)|regen|approved|rejected
  source?: string;               // studio|graph_run|batch|node_preview|standalone|test
  cost_hint?: string | null;
  reason?: string | null;
  niche?: string | null;
  article?: string | null;
}

export interface GenHistoryResult {
  history: GenHistoryRow[];
  warning?: string;
  summary?: {
    attempts: number;
    outputs: number;
    best_otk: number | null;
    last_status: string | null;
    last_at: string | null;
    variant_count: number;
    attempt_span: number;
  };
}

function summarizeHistory(history: GenHistoryRow[]) {
  let outputs = 0;
  let bestOtk: number | null = null;
  let maxAttempt = 0;
  const variants = new Set<number>();
  for (const row of history) {
    if (row.output_url) outputs += 1;
    const otk = typeof row.otk_score === "number" ? row.otk_score : null;
    if (otk != null && (bestOtk == null || otk > bestOtk)) bestOtk = otk;
    const attempt = Number(row.attempt) || 0;
    if (attempt > maxAttempt) maxAttempt = attempt;
    const variant = Number(row.variant_idx);
    if (variant > 0) variants.add(variant);
  }
  return {
    attempts: history.length,
    outputs,
    best_otk: bestOtk,
    last_status: history[0]?.status || null,
    last_at: (history[0] as { created_at?: string } | undefined)?.created_at || null,
    variant_count: variants.size,
    attempt_span: maxAttempt,
  };
}

// Записать попытку. Возвращает id строки (для parent_id следующей итерации) или null при мягкой деградации.
export async function logGeneration(row: GenHistoryRow): Promise<number | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  try {
    const { data, error } = await db
      .from("generation_history")
      .insert({
        parent_id: row.parent_id ?? null,
        recipe_id: row.recipe_id ?? null,
        node_id: row.node_id ?? null,
        variant_idx: row.variant_idx ?? null,
        attempt: row.attempt ?? 1,
        tool: row.tool ?? null,
        engine: row.engine ?? null,
        node_type: row.node_type ?? null,
        prompt: typeof row.prompt === "string" ? row.prompt.slice(0, 4000) : null,
        params: row.params ?? null,
        input_url: row.input_url ?? null,
        output_url: row.output_url ?? null,
        otk_score: typeof row.otk_score === "number" ? row.otk_score : null,
        otk_axes: row.otk_axes ?? null,
        otk_verdict: row.otk_verdict ?? null,
        artifact_ok: typeof row.artifact_ok === "boolean" ? row.artifact_ok : null,
        status: row.status || "generated",
        source: row.source || "studio",
        cost_hint: row.cost_hint ?? null,
        reason: row.reason ?? null,
        niche: row.niche ?? null,
        article: row.article ?? null,
      })
      .select("id")
      .limit(1);
    if (error) return null;
    return (data as { id: number }[] | null)?.[0]?.id ?? null;
  } catch {
    return null; // таблица не применена / транзиент — конвейер не падает
  }
}

// История по рецепту (для кнопки «история» на карточке) — последние попытки, новые сверху.
export async function getRecipeHistoryResult(recipeId: number, limit = 50): Promise<GenHistoryResult> {
  const db = getSupabaseAdmin();
  if (!db) return { history: [], warning: "Supabase не настроен" };
  try {
    const { data, error } = await db
      .from("generation_history")
      .select("*")
      .eq("recipe_id", recipeId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return { history: [], warning: error.message.slice(0, 160) };
    const history = (data as GenHistoryRow[]) || [];
    return { history, summary: summarizeHistory(history) };
  } catch (e) {
    return { history: [], warning: String((e as Error)?.message || e).slice(0, 160) };
  }
}

export async function getRecipeHistory(recipeId: number, limit = 50): Promise<GenHistoryRow[]> {
  return (await getRecipeHistoryResult(recipeId, limit)).history;
}
