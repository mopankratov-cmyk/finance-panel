import type { SupabaseClient } from "@supabase/supabase-js";

export type PlanningStateJson = Record<string, unknown>;

export interface PlanningStateSnapshot<TState extends PlanningStateJson = PlanningStateJson> {
  data: TState;
  exists: boolean;
  updatedAt: string | null;
}

export type PlanningStateWriteResult =
  | { ok: true }
  | { ok: false; conflict: true }
  | { ok: false; error: string };

export async function loadPlanningState<TState extends PlanningStateJson = PlanningStateJson>(
  db: SupabaseClient,
  year: number,
  options: { signal?: AbortSignal } = {},
): Promise<PlanningStateSnapshot<TState>> {
  options.signal?.throwIfAborted();
  let query = db
    .from("planning_state")
    .select("data, updated_at")
    .eq("year", year);
  if (options.signal) query = query.abortSignal(options.signal);
  const { data, error } = await query.maybeSingle();

  if (error) throw new Error(error.message);

  return {
    data: ((data?.data ?? {}) as TState),
    exists: Boolean(data),
    updatedAt: typeof data?.updated_at === "string" ? data.updated_at : null,
  };
}

export async function writePlanningStateSnapshot<TState extends PlanningStateJson = PlanningStateJson>(
  db: SupabaseClient,
  year: number,
  snapshot: PlanningStateSnapshot,
  data: TState,
  updatedAt: string,
): Promise<PlanningStateWriteResult> {
  if (!snapshot.exists) {
    const { error } = await db
      .from("planning_state")
      .insert({ year, data, updated_at: updatedAt });

    if (!error) return { ok: true };
    if (error.code === "23505") return { ok: false, conflict: true };
    return { ok: false, error: error.message };
  }

  const update = db
    .from("planning_state")
    .update({ data, updated_at: updatedAt })
    .eq("year", year);

  const guardedUpdate = snapshot.updatedAt
    ? update.eq("updated_at", snapshot.updatedAt)
    : update.is("updated_at", null);

  const { data: updatedRow, error } = await guardedUpdate
    .select("year")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!updatedRow) return { ok: false, conflict: true };
  return { ok: true };
}
