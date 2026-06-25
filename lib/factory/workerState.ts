import { promises as fs } from "fs";
import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";

const WORKER_ID = "railway-content-factory";
const QUEUE_FILE = path.join(process.cwd(), "docs/factory-railway-task-queue.md");
const LOG_FILE = path.join(process.cwd(), "docs/factory-railway-night-log.md");
const TABLE = "railway_worker_states";
const STALE_MS = 5 * 60 * 1000;
const DEAD_MS = 15 * 60 * 1000;
const WORKER_HEARTBEAT_MIGRATION = "supabase/migrations/20260624_factory_railway_worker_state.sql";

export type QueueTask = {
  id: string;
  title: string;
  status: string;
  priority?: string | null;
  branch?: string | null;
  pr?: string | null;
  zone?: string | null;
  goal?: string | null;
  result?: string | null;
  blockers?: string[];
  acceptance?: string[];
  checks?: string[];
  raw?: string;
};

export type WorkerRow = {
  worker_id: string;
  label?: string | null;
  status?: string | null;
  branch?: string | null;
  pr?: string | null;
  current_task_id?: string | null;
  current_task_title?: string | null;
  progress?: string | null;
  blocker?: string | null;
  note?: string | null;
  queue?: unknown;
  last_seen?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  source?: "heartbeat_db" | "queue_fallback";
};

export type WorkerHeartbeatIssue = "table_missing" | "db_permissions" | "sender_missing" | "fallback_active" | null;

function toText(v: unknown): string {
  if (typeof v !== "string") return "";
  const text = v.trim();
  const wrapped = text.match(/^`([^`]+)`$/);
  return wrapped ? wrapped[1].trim() : text;
}

function parseQueue(md: string): QueueTask[] {
  const tasks: QueueTask[] = [];
  const blocks = md.split(/^### /m).slice(1);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const title = lines[0]?.trim() || "";
    if (!title || title.toLowerCase().includes("архив")) continue;
    const task: QueueTask = { id: title.split("·")[0]?.trim() || "", title, status: "todo", blockers: [], acceptance: [], checks: [] };
    let section: "none" | "acceptance" | "checks" | "blockers" = "none";
    for (const line of lines.slice(1)) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith("- Статус:")) { task.status = toText(t.slice(9)) || task.status; section = "none"; continue; }
      if (t.startsWith("- Приоритет:")) { task.priority = toText(t.slice(12)) || null; section = "none"; continue; }
      if (t.startsWith("- Ветка:")) { task.branch = toText(t.slice(8)) || null; section = "none"; continue; }
      if (t.startsWith("- PR:")) { task.pr = toText(t.slice(5)) || null; section = "none"; continue; }
      if (t.startsWith("- Зона:")) { task.zone = toText(t.slice(7)) || null; section = "none"; continue; }
      if (t.startsWith("- Цель:")) { task.goal = toText(t.slice(7)) || null; section = "none"; continue; }
      if (t.startsWith("- Итог:")) { task.result = toText(t.slice(7)) || null; section = "none"; continue; }
      if (t.startsWith("- Блокеры:")) {
        const inline = toText(t.slice(11));
        if (inline) task.blockers!.push(inline);
        section = "blockers";
        continue;
      }
      if (t.startsWith("- Acceptance criteria:")) { section = "acceptance"; continue; }
      if (t.startsWith("- Проверки:")) { section = "checks"; continue; }
      if (section === "acceptance" && t.startsWith("- [ ]")) { task.acceptance!.push(t.replace(/^- \[ \]\s*/, "").replace(/^- \[\]\s*/, "").trim()); continue; }
      if (section === "checks" && t.startsWith("- [ ]")) { task.checks!.push(t.replace(/^- \[ \]\s*/, "").replace(/^- \[\]\s*/, "").trim()); continue; }
      if (section === "blockers" && t.startsWith("-")) { task.blockers!.push(t.replace(/^-+\s*/, "").trim()); continue; }
      if (!task.id && t.startsWith("- ")) { task.id = t.replace(/^-+\s*/, "").split("·")[0]?.trim() || ""; }
    }
    task.acceptance = task.acceptance!.filter(Boolean);
    task.checks = task.checks!.filter(Boolean);
    task.blockers = task.blockers!.filter(Boolean);
    tasks.push(task);
  }
  return tasks;
}

async function readMaybe(filePath: string): Promise<{ text: string; mtime: string | null }> {
  try {
    const [text, stat] = await Promise.all([fs.readFile(filePath, "utf8"), fs.stat(filePath)]);
    return { text, mtime: stat.mtime.toISOString() };
  } catch {
    return { text: "", mtime: null };
  }
}

function summarizeNightLog(md: string): { top: string; lines: string[] } {
  if (!md.trim()) return { top: "", lines: [] };
  const top = md.split("\n## Записи")[0].trim();
  const lines = top.split(/\r?\n/).slice(0, 30).map((s) => s.trimEnd()).filter(Boolean);
  return { top, lines };
}

export function liveness(lastSeen?: string | null): { state: "unknown" | "alive" | "stale" | "dead"; age_sec: number | null } {
  if (!lastSeen) return { state: "unknown", age_sec: null };
  const ms = new Date(lastSeen).getTime();
  if (!Number.isFinite(ms)) return { state: "unknown", age_sec: null };
  const age = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (age * 1000 >= DEAD_MS) return { state: "dead", age_sec: age };
  if (age * 1000 >= STALE_MS) return { state: "stale", age_sec: age };
  return { state: "alive", age_sec: age };
}

export function classifyWorkerHeartbeatIssue(
  dbError: string | null,
  workerSource: "heartbeat_db" | "queue_fallback" | "unknown",
  workerLastSeen: string | null,
): WorkerHeartbeatIssue {
  const text = String(dbError || "").toLowerCase();
  if (text.includes("schema cache") || text.includes("could not find the table")) return "table_missing";
  if (text.includes("permission") || text.includes("row-level") || text.includes("rls")) return "db_permissions";
  if (workerSource === "queue_fallback" && !workerLastSeen) return "sender_missing";
  if (workerSource === "queue_fallback") return "fallback_active";
  return null;
}

export function buildWorkerHeartbeatDiagnostics(input: {
  dbError: string | null;
  workerSource: "heartbeat_db" | "queue_fallback" | "unknown";
  workerLastSeen: string | null;
}) {
  const issue = classifyWorkerHeartbeatIssue(input.dbError, input.workerSource, input.workerLastSeen);
  if (!issue) return null;
  const diagnostics = {
    issue,
    migration_path: WORKER_HEARTBEAT_MIGRATION,
    sender_command: "BASE_URL=https://finance-panel-two.vercel.app CRON_SECRET=... node lib/factory/workerHeartbeat.mjs --every-sec=120",
    sender_script: "lib/factory/workerHeartbeat.mjs",
    endpoint: "/api/factory/worker-state",
    detail: input.dbError || "",
    next_step:
      issue === "table_missing" ? "apply_supabase_migration"
      : issue === "db_permissions" ? "repair_supabase_permissions"
      : issue === "sender_missing" ? "start_worker_heartbeat_sender"
      : "inspect_worker_fallback",
  };
  return diagnostics;
}

export async function loadWorkerDocs() {
  const [queue, log] = await Promise.all([readMaybe(QUEUE_FILE), readMaybe(LOG_FILE)]);
  return {
    queue: parseQueue(queue.text),
    queue_file_mtime: queue.mtime,
    log: summarizeNightLog(log.text),
    log_file_mtime: log.mtime,
  };
}

function deriveWorkerFromQueue(queue: QueueTask[]): WorkerRow | null {
  const active = queue.find((task) => task.status === "doing")
    || queue.find((task) => task.status === "blocked")
    || queue.find((task) => task.status === "todo")
    || null;
  if (!active) return null;
  return {
    worker_id: WORKER_ID,
    label: "Railway worker",
    status: active.status || "unknown",
    branch: active.branch || null,
    pr: active.pr || null,
    current_task_id: active.id || null,
    current_task_title: active.title || null,
    blocker: active.blockers?.[0] || null,
    note: "derived from queue fallback",
    last_seen: null,
    updated_at: null,
    source: "queue_fallback",
  };
}

export async function loadWorkerSnapshot(db: SupabaseClient, fallbackQueue: QueueTask[] = []) {
  const { data, error } = await db.from(TABLE).select("*").order("updated_at", { ascending: false }).limit(10);
  let workers: Array<WorkerRow & { liveness: ReturnType<typeof liveness> }> = ((data as WorkerRow[] | null) || []).map((w) => ({
    ...w,
    source: "heartbeat_db" as const,
    liveness: liveness(w.last_seen),
  }));
  if (!workers.length) {
    const derived = deriveWorkerFromQueue(fallbackQueue);
    if (derived) workers = [{ ...derived, liveness: liveness(derived.last_seen) }];
  }
  return {
    worker: workers[0] || null,
    workers,
    db_error: error?.message || null,
  };
}

export { TABLE as WORKER_STATE_TABLE, WORKER_ID, WORKER_HEARTBEAT_MIGRATION };
