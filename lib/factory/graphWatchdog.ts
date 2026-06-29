import type { SupabaseClient } from "@supabase/supabase-js";
import { advanceClaimedRecipe, claimNextRecipe } from "./graphRun";
import type { RunPlan } from "./graphTypes";

const DEFAULT_STALE_MS = 90_000;
const DEFAULT_MAX_WAKE = 10;
const RENDER_POLL_FORCE_RELEASE_MS = 240_000;
const GEN_POLL_FORCE_RELEASE_MS = 540_000;

type WakeResult = { id: number; from: string };

function leaseFree(plan: RunPlan | null): boolean {
  if (!plan) return false;
  if (!plan.lease_until) return true;
  const t = new Date(plan.lease_until as string).getTime();
  return !Number.isFinite(t) || t < Date.now();
}

function pollStepOverdue(plan: RunPlan | null): boolean {
  if (!plan || (plan.step !== "render-poll" && plan.step !== "gen-poll")) return false;
  const started = plan.step_started_at ? new Date(plan.step_started_at as string).getTime() : NaN;
  const maxAge = plan.step === "render-poll" ? RENDER_POLL_FORCE_RELEASE_MS : GEN_POLL_FORCE_RELEASE_MS;
  return Number.isFinite(started) && Date.now() - started >= maxAge;
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

  const { data: autofillData } = await db.from("node_recipes")
    .select("id,run_plan,updated_at")
    .eq("status", "running")
    .contains("run_plan", { step: "autofill" })
    .order("updated_at", { ascending: true })
    .limit(maxWake);

  const { data: recentData } = await db.from("node_recipes")
    .select("id,run_plan,updated_at")
    .eq("status", "running")
    .order("updated_at", { ascending: false })
    .limit(maxWake);

  const byId = new Map<number, { id: number; run_plan: RunPlan | null; updated_at?: string | null }>();
  for (const row of [
    ...((autofillData as { id: number; run_plan: RunPlan | null; updated_at?: string | null }[] | null) || []),
    ...((recentData as { id: number; run_plan: RunPlan | null; updated_at?: string | null }[] | null) || []),
    ...((data as { id: number; run_plan: RunPlan | null; updated_at?: string | null }[] | null) || []),
  ]) {
    const prev = byId.get(row.id);
    if (!prev) {
      byId.set(row.id, row);
      continue;
    }
    const prevTs = prev.updated_at ? new Date(prev.updated_at).getTime() : Number.POSITIVE_INFINITY;
    const nextTs = row.updated_at ? new Date(row.updated_at).getTime() : Number.POSITIVE_INFINITY;
    if (nextTs < prevTs) byId.set(row.id, row);
  }
  const rows = Array.from(byId.values())
    .sort((a, b) => {
      const stepA = String(a.run_plan?.step || "");
      const stepB = String(b.run_plan?.step || "");
      const autoA = stepA === "autofill" ? 0 : 1;
      const autoB = stepB === "autofill" ? 0 : 1;
      if (autoA !== autoB) return autoA - autoB;
      const aTs = a.updated_at ? new Date(a.updated_at).getTime() : Number.POSITIVE_INFINITY;
      const bTs = b.updated_at ? new Date(b.updated_at).getTime() : Number.POSITIVE_INFINITY;
      return bTs - aTs;
    })
    .slice(0, maxWake);

  for (const row of rows) {
    const p = row.run_plan;
    if (!p || leaseFree(p) || !pollStepOverdue(p)) continue;
    p.lease_until = null;
    try {
      await db.from("node_recipes").update({ run_plan: p, updated_at: new Date().toISOString() }).eq("id", row.id);
    } catch {
      /* best-effort: обычный lease timeout/cron подхватит следующий такт */
    }
  }

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
