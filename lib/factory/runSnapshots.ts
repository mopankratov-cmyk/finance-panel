import type { SupabaseClient } from "@supabase/supabase-js";
import { buildObservability, buildStabilityReport } from "@/lib/factory/observability";

export const DEFAULT_OBSERVABILITY_LIMIT = 48;
export const DEFAULT_STUDIO_LIMIT = 30;

export type RecipeRunRow = Record<string, unknown>;

export async function loadRecentRecipeRunRows(
  db: SupabaseClient,
  limit = DEFAULT_OBSERVABILITY_LIMIT,
): Promise<RecipeRunRow[]> {
  const { data, error } = await db
    .from("node_recipes")
    .select("id,status,created_at,run_plan")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(`node_recipes snapshot: ${error.message}`);
  }
  return (data as RecipeRunRow[] | null) || [];
}

export async function loadObservabilitySnapshot(
  db: SupabaseClient,
  limit = DEFAULT_OBSERVABILITY_LIMIT,
) {
  const rows = await loadRecentRecipeRunRows(db, limit);
  return {
    rows,
    observability: buildObservability(rows),
  };
}

export async function loadStabilitySnapshot(
  db: SupabaseClient,
  limit = DEFAULT_OBSERVABILITY_LIMIT,
) {
  const rows = await loadRecentRecipeRunRows(db, limit);
  return {
    rows,
    stability: buildStabilityReport(rows),
  };
}
