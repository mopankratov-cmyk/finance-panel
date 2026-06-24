import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

const WORKER_ID = "railway-content-factory";
const QUEUE_FILE = path.join(process.cwd(), "docs/factory-railway-task-queue.md");
const LOG_FILE = path.join(process.cwd(), "docs/factory-railway-night-log.md");
const TABLE = "railway_worker_states";
const STALE_MS = 5 * 60 * 1000;
const DEAD_MS = 15 * 60 * 1000;

type QueueTask = {
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

type WorkerRow = {
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
};

function toText(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function parseList(line: string): string[] {
  return line
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseQueue(md: string): QueueTask[] {
  const tasks: QueueTask[] = [];
  const blocks = md.split(/^### /m).slice(1);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const title = lines[0]?.trim() || "";
    if (!title || title.toLowerCase().includes("архив")) continue;
    const task: QueueTask = { id: "", title, status: "todo", blockers: [], acceptance: [], checks: [] };
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
      if (t.startsWith("- Блокеры:")) { section = "blockers"; continue; }
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

function liveness(lastSeen?: string | null): { state: "unknown" | "alive" | "stale" | "dead"; age_sec: number | null } {
  if (!lastSeen) return { state: "unknown", age_sec: null };
  const ms = new Date(lastSeen).getTime();
  if (!Number.isFinite(ms)) return { state: "unknown", age_sec: null };
  const age = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (age * 1000 >= DEAD_MS) return { state: "dead", age_sec: age };
  if (age * 1000 >= STALE_MS) return { state: "stale", age_sec: age };
  return { state: "alive", age_sec: age };
}

async function loadDocs() {
  const [queue, log] = await Promise.all([readMaybe(QUEUE_FILE), readMaybe(LOG_FILE)]);
  return {
    queue: parseQueue(queue.text),
    queue_file_mtime: queue.mtime,
    log: summarizeNightLog(log.text),
    log_file_mtime: log.mtime,
  };
}

export async function GET() {
  const db = getSupabaseAdmin();
  const docs = await loadDocs();
  if (!db) {
    return NextResponse.json({
      ok: true,
      db_ready: false,
      worker: null,
      queue: docs.queue,
      docs,
    }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const { data, error } = await db.from(TABLE).select("*").order("updated_at", { ascending: false }).limit(10);
    const workers = (data as WorkerRow[] | null) || [];
    const normalized = workers.map((w) => ({ ...w, liveness: liveness(w.last_seen) }));
    return NextResponse.json({
      ok: true,
      db_ready: true,
      worker: normalized[0] || null,
      workers: normalized,
      queue: docs.queue,
      docs,
      db_error: error?.message || null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: true,
      db_ready: false,
      worker: null,
      queue: docs.queue,
      docs,
      error: String(e).slice(0, 200),
    }, { headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const secret = process.env.CRON_SECRET || "";
  const auth = req.headers.get("authorization") || "";
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const worker_id = toText(body.worker_id) || WORKER_ID;
  if (!worker_id) return NextResponse.json({ error: "нужен worker_id" }, { status: 400 });

  const queue = Array.isArray(body.queue) ? body.queue.slice(0, 30) : undefined;
  const now = new Date().toISOString();
  const payload = {
    worker_id,
    label: toText(body.label) || "Railway worker",
    status: toText(body.status) || "idle",
    branch: toText(body.branch) || null,
    pr: toText(body.pr) || null,
    current_task_id: toText(body.current_task_id) || null,
    current_task_title: toText(body.current_task_title) || null,
    progress: toText(body.progress) || null,
    blocker: toText(body.blocker) || null,
    note: toText(body.note) || null,
    queue: queue ?? null,
    last_seen: now,
    updated_at: now,
  };

  const { error } = await db.from(TABLE).upsert(payload, { onConflict: "worker_id" });
  if (error) return NextResponse.json({ error: `railway_worker_states: ${error.message}` }, { status: 500 });
  return NextResponse.json({ ok: true, worker_id, last_seen: now });
}
