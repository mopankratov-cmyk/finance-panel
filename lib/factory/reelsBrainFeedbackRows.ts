import { normalizeTargetPlatform } from "./reelsBrainPlaybook";
import { inferHookType, inferStructureType } from "./reelsBrainPatterns";

type DbClient = NonNullable<any>;

export type ReelsBrainFeedbackMetricRow = {
  recipe_id?: number | null;
  platform?: string | null;
  views?: number | null;
  watch_rate?: number | null;
  hook_rate?: number | null;
  hold_rate?: number | null;
  completion_rate?: number | null;
  ctr_card?: number | null;
  saves?: number | null;
  marketplace_orders?: number | null;
  revenue?: number | null;
  posted_at?: string | null;
  pulled_at?: string | null;
  publication_id?: string | null;
  external_post_id?: string | null;
  source?: string | null;
  raw_metrics?: Record<string, unknown> | null;
  niche?: string | null;
  article?: string | null;
  target_platform?: string | null;
  segment_label?: string | null;
  hook_text?: string | null;
  hook_type?: string | null;
  structure_type?: string | null;
  pattern_signature?: string | null;
  measurement_id?: string | null;
  validation_task_id?: string | null;
  proof_scope?: string | null;
  high_trust_generation_ready?: boolean | null;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function bool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const raw = text(value).toLowerCase();
  if (!raw) return null;
  if (["1", "true", "yes", "ready", "high"].includes(raw)) return true;
  if (["0", "false", "no", "not_ready", "low"].includes(raw)) return false;
  return null;
}

function recipeNiche(runPlan: Record<string, unknown> | null | undefined, fallback?: string | null) {
  const direct = text(fallback);
  if (direct) return direct;
  const plan = runPlan || {};
  return text(plan.niche) || text((plan.product as Record<string, unknown> | undefined)?.niche) || text((plan.inputs as Record<string, unknown> | undefined)?.niche);
}

function runPlanHookText(runPlan: Record<string, unknown> | null | undefined) {
  const plan = runPlan || {};
  const nodes = Array.isArray(plan.nodes) ? plan.nodes as Array<Record<string, unknown>> : [];
  const hookNode = nodes.find((node) => String((node.params as Record<string, unknown> | undefined)?.role || node.slot || "").toLowerCase() === "hook")
    || nodes[0];
  if (!hookNode) return "";
  const params = hookNode.params && typeof hookNode.params === "object" ? hookNode.params as Record<string, unknown> : {};
  return text(hookNode.onscreen_text) || text(params.onscreen_text) || text(hookNode.prompt);
}

function runPlanStructure(runPlan: Record<string, unknown> | null | undefined) {
  const plan = runPlan || {};
  return text(plan.structure)
    || text((plan.generator_payload as Record<string, unknown> | undefined)?.structure)
    || text((plan.brief_seed as Record<string, unknown> | undefined)?.structure)
    || text((plan.creative_brief as Record<string, unknown> | undefined)?.structure);
}

export async function loadReelsBrainFeedbackRows(
  db: DbClient,
  limit = 300,
): Promise<{ rows: ReelsBrainFeedbackMetricRow[]; warning: string | null }> {
  try {
    const { data, error } = await db
      .from("post_metrics")
      .select("recipe_id,platform,views,watch_rate,hook_rate,hold_rate,completion_rate,ctr_card,saves,marketplace_orders,revenue,posted_at,pulled_at,publication_id,external_post_id,source,raw_metrics")
      .limit(limit);
    if (error) return { rows: [], warning: `post_metrics: ${error.message}` };
    const rows = ((data || []) as ReelsBrainFeedbackMetricRow[]);
    const recipeIds = Array.from(new Set(rows.map((row) => Number(row.recipe_id)).filter((id) => Number.isFinite(id) && id > 0)));
    let recipeMap = new Map<number, {
      niche?: string | null;
      article?: string | null;
      mode?: string | null;
      format_detected?: string | null;
      run_plan?: Record<string, unknown> | null;
    }>();
    if (recipeIds.length) {
      const { data: recipes, error: recipeError } = await db
        .from("node_recipes")
        .select("id,niche,article,mode,format_detected,run_plan")
        .in("id", recipeIds);
      if (recipeError) {
        return { rows, warning: `node_recipes: ${recipeError.message}` };
      }
      recipeMap = new Map(
        (((recipes || []) as Array<{
          id?: number;
          niche?: string | null;
          article?: string | null;
          mode?: string | null;
          format_detected?: string | null;
          run_plan?: Record<string, unknown> | null;
        }>))
          .map((row) => [Number(row.id), row] as const),
      );
    }

    const enriched = rows.map((row) => {
      const recipe = recipeMap.get(Number(row.recipe_id)) || null;
      const runPlan = (recipe?.run_plan || null) as Record<string, unknown> | null;
      const niche = recipeNiche(runPlan, recipe?.niche || null);
      const targetPlatform = normalizeTargetPlatform(row.platform || runPlan?.target_platform || "");
      const platform = targetPlatform === "unknown" ? text(row.platform) : targetPlatform;
      const hookText = runPlanHookText(runPlan) || text(recipe?.article);
      const hookType = inferHookType(hookText);
      const structureType = inferStructureType(
        text(recipe?.format_detected) || runPlanStructure(runPlan) || text(recipe?.mode),
        text(recipe?.article),
      );
      const rawMetrics = (row.raw_metrics && typeof row.raw_metrics === "object" ? row.raw_metrics : {}) as Record<string, unknown>;
      return {
        ...row,
        niche: niche || null,
        article: text(recipe?.article) || null,
        target_platform: platform || null,
        segment_label: niche && platform && platform !== "unknown" ? `${niche} × ${platform}` : null,
        hook_text: hookText || null,
        hook_type: hookType || null,
        structure_type: structureType || null,
        pattern_signature: hookType && structureType ? `${hookType}:${structureType}` : null,
        measurement_id: text(rawMetrics.measurement_id) || null,
        validation_task_id: text(rawMetrics.validation_task_id) || null,
        proof_scope: text(rawMetrics.proof_scope) || null,
        high_trust_generation_ready: bool(rawMetrics.high_trust_generation_ready),
      };
    });

    return { rows: enriched, warning: null };
  } catch (error) {
    return { rows: [], warning: `feedback rows exception: ${String((error as Error)?.message || error).slice(0, 140)}` };
  }
}
