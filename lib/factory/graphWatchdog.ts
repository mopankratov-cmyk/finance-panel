import type { SupabaseClient } from "@supabase/supabase-js";
import { advanceClaimedRecipe, claimNextRecipe } from "./graphRun";
import type { RunPlan } from "./graphTypes";

const DEFAULT_STALE_MS = 90_000;
const DEFAULT_MAX_WAKE = 3;

type WakeResult = { id: number; from: string };

function leaseFree(plan: RunPlan | null): boolean {
  if (!plan) return false;
  if (!plan.lease_until) return true;
  const t = new Date(plan.lease_until as string).getTime();
  return !Number.isFinite(t) || t < Date.now();
}

export type WatchdogResult = {
  scanned: number;
  stuck: number;
  woken: number[];
  advanced: WakeResult[];
  trigger: string;
};

export async function wakeStaleRecipes(
  db: SupabaseClient,
  origin: string,
  opts?: { staleMs?: number; maxWake?: number; trigger?: string },
): Promise<WatchdogResult> {
  const staleMs = opts?.staleMs ?? DEFAULT_STALE_MS;
  const maxWake = opts?.maxWake ?? DEFAULT_MAX_WAKE;
  const trigger = opts?.trigger || "cron";
  const staleBefore = new Date(Date.now() - staleMs).toISOString();

  const { data } = await db.from("node_recipes")
    .select("id,run_plan,updated_at")
    .eq("status", "running")
    .lt("updated_at", staleBefore)
    .order("updated_at", { ascending: true })
    .limit(maxWake);

  const rows = (data as { id: number; run_plan: RunPlan | null }[] | null) || [];
  const stuck = rows.filter((r) => {
    const p = r.run_plan;
    return p && p.step !== "done" && p.step !== "failed" && leaseFree(p);
  });

  const woken: number[] = [];
  const advanced: WakeResult[] = [];

  // Sprint 1: backstop wake идёт последовательно.
  // Cron здесь нужен как предсказуемая страховка, а не как второй burst-runner поверх self-chain.
  for (const row of stuck) {
    const ctx = await claimNextRecipe(db, row.id);
    if (!ctx) continue; // лиз заняла живая цепочка / гонка — пропускаем
    woken.push(row.id);
    const before = ctx.plan.step;
    const result = await advanceClaimedRecipe(db, origin, ctx);
    if (result.ok) advanced.push({ id: row.id, from: before });
  }

  if (woken.length) {
    try {
      await db.from("cf_signals").insert({
        event: "graph_resurrect",
        params: { woken, advanced, scanned: rows.length, trigger },
      });
    } catch {
      /* журнал best-effort */
    }
    console.warn(`[graph-${trigger}] разбужено: ${woken.length} (${woken.join(",")}), продвинуто: ${advanced.length}`);
  }

  return { scanned: rows.length, stuck: stuck.length, woken, advanced, trigger };
}
