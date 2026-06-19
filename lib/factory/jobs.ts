import type { SupabaseClient } from "@supabase/supabase-js";

// Серверная очередь генераций. Self-chaining: каждый тик берёт одну джобу, делает ОДИН шаг (<60с),
// пишет состояние, дёргает следующий тик. Лиз защищает от двойной обработки одной джобы.

export type JobStatus = "queued" | "running" | "polling" | "done" | "failed";
export type JobStep = "produce" | "scenario" | "submit" | "poll" | "otk" | "overlay" | "save" | "assemble" | "compose-submit" | "compose-poll" | "done";

export interface FactoryJob {
  id: string;
  status: JobStatus;
  step: JobStep;
  article: string | null;
  hook: string | null;
  mode: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: Record<string, any> | null;
  error: string | null;
  attempts: number;
  lease_until: string | null;
}

const LEASE_MS = 90_000;               // на время обработки шага джоба «занята»
export const MAX_STEP_ATTEMPTS = 3;    // ошибок одного шага подряд → fail
export const MAX_POLLS = 35;           // ~35 тиков × ~12с ≈ 7 мин ожидания рендера → timeout
const ACTIVE: JobStatus[] = ["queued", "running", "polling"];

export async function createJob(db: SupabaseClient, j: { article?: string; hook: string; mode?: string }): Promise<string | null> {
  const { data, error } = await db.from("factory_jobs").insert({
    status: "queued", step: "produce",
    article: j.article || null, hook: j.hook, mode: j.mode === "sell" ? "sell" : "audience",
  }).select("id").maybeSingle();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

// Best-effort атомарный захват одной готовой джобы: активная + свободный лиз.
// Гонку решает условный UPDATE с тем же фильтром свободного лиза (побеждает один).
export async function claimNextJob(db: SupabaseClient): Promise<FactoryJob | null> {
  const nowIso = new Date().toISOString();
  const leaseIso = new Date(Date.now() + LEASE_MS).toISOString();
  const freeFilter = `lease_until.is.null,lease_until.lt.${nowIso}`;
  const { data: cands } = await db.from("factory_jobs")
    .select("id").in("status", ACTIVE).or(freeFilter)
    .order("created_at", { ascending: true }).limit(1);
  if (!cands || !cands.length) return null;
  const id = (cands[0] as { id: string }).id;
  const { data: claimed } = await db.from("factory_jobs")
    .update({ status: "running", lease_until: leaseIso, updated_at: nowIso })
    .eq("id", id).or(freeFilter).select("*").maybeSingle();
  return (claimed as FactoryJob) || null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function saveJob(db: SupabaseClient, id: string, patch: Record<string, any>): Promise<void> {
  await db.from("factory_jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
}

export async function listJobs(db: SupabaseClient, limit = 50): Promise<FactoryJob[]> {
  const { data } = await db.from("factory_jobs").select("*").order("created_at", { ascending: false }).limit(limit);
  return (data as FactoryJob[]) || [];
}

// Есть ли незавершённая джоба со свободным лизом (зависшая цепочка → надо разбудить тик).
export function hasStuck(jobs: FactoryJob[]): boolean {
  const now = Date.now();
  return jobs.some((j) => ACTIVE.includes(j.status) && (!j.lease_until || new Date(j.lease_until).getTime() < now));
}
