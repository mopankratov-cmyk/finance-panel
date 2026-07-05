import { normalizeTargetPlatform } from "./reelsBrainPlaybook";

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
  niche?: string | null;
  article?: string | null;
  target_platform?: string | null;
  segment_label?: string | null;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function recipeNiche(runPlan: Record<string, unknown> | null | undefined, fallback?: string | null) {
  const direct = text(fallback);
  if (direct) return direct;
  const plan = runPlan || {};
  return text(plan.niche) || text((plan.product as Record<string, unknown> | undefined)?.niche) || text((plan.inputs as Record<string, unknown> | undefined)?.niche);
}

export async function loadReelsBrainFeedbackRows(
  db: DbClient,
  limit = 300,
): Promise<{ rows: ReelsBrainFeedbackMetricRow[]; warning: string | null }> {
  try {
    const { data, error } = await db
      .from("post_metrics")
      .select("recipe_id,platform,views,watch_rate,hook_rate,hold_rate,completion_rate,ctr_card,saves,marketplace_orders,revenue,posted_at,pulled_at,publication_id,external_post_id,source")
      .limit(limit);
    if (error) return { rows: [], warning: `post_metrics: ${error.message}` };
    const rows = ((data || []) as ReelsBrainFeedbackMetricRow[]);
    const recipeIds = Array.from(new Set(rows.map((row) => Number(row.recipe_id)).filter((id) => Number.isFinite(id) && id > 0)));
    let recipeMap = new Map<number, { niche?: string | null; article?: string | null; run_plan?: Record<string, unknown> | null }>();
    if (recipeIds.length) {
      const { data: recipes, error: recipeError } = await db
        .from("node_recipes")
        .select("id,niche,article,run_plan")
        .in("id", recipeIds);
      if (recipeError) {
        return { rows, warning: `node_recipes: ${recipeError.message}` };
      }
      recipeMap = new Map(
        (((recipes || []) as Array<{ id?: number; niche?: string | null; article?: string | null; run_plan?: Record<string, unknown> | null }>))
          .map((row) => [Number(row.id), row] as const),
      );
    }

    const enriched = rows.map((row) => {
      const recipe = recipeMap.get(Number(row.recipe_id)) || null;
      const runPlan = (recipe?.run_plan || null) as Record<string, unknown> | null;
      const niche = recipeNiche(runPlan, recipe?.niche || null);
      const targetPlatform = normalizeTargetPlatform(row.platform || runPlan?.target_platform || "");
      const platform = targetPlatform === "unknown" ? text(row.platform) : targetPlatform;
      return {
        ...row,
        niche: niche || null,
        article: text(recipe?.article) || null,
        target_platform: platform || null,
        segment_label: niche && platform && platform !== "unknown" ? `${niche} × ${platform}` : null,
      };
    });

    return { rows: enriched, warning: null };
  } catch (error) {
    return { rows: [], warning: `feedback rows exception: ${String((error as Error)?.message || error).slice(0, 140)}` };
  }
}
