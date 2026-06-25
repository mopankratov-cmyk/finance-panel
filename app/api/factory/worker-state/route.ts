import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadObservabilitySnapshot } from "@/lib/factory/runSnapshots";
import { readLatestStressArtifact, readStressHistorySummary } from "@/lib/factory/stabilityArtifacts";
import { buildWorkerHeartbeatDiagnostics, loadWorkerDocs, loadWorkerSnapshot, WORKER_ID, WORKER_STATE_TABLE } from "@/lib/factory/workerState";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

const EMPTY_OBSERVABILITY: Record<string, unknown> = {
  sample_runs: 0,
  running: 0,
  stale_running: 0,
  warning_runs: 0,
  failed: 0,
  stability_snapshot: null,
  quality_signal: null,
  recent_runs: [],
  incident_runs: [],
  status_series: [],
  step_duration_series: [],
  slowest_steps: [],
  failure_diagnostics: null,
  top_error_categories: [],
  top_errors: [],
  top_warning_categories: [],
  top_warnings: [],
};

function toText(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function GET() {
  try {
    const db = getSupabaseAdmin();
    const docs = await loadWorkerDocs();
    const latestStressPromise = readLatestStressArtifact();
    const stressHistoryPromise = readStressHistorySummary();
    if (!db) {
      return NextResponse.json({
        ok: true,
        db_ready: false,
        worker: null,
        queue: docs.queue,
        docs,
        observability: null,
        latest_stress: await latestStressPromise,
        stress_history: await stressHistoryPromise,
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const [workerState, observabilitySnapshot, latestStress, stressHistory] = await Promise.all([
      loadWorkerSnapshot(db, docs.queue),
      loadObservabilitySnapshot(db, 30).then((value) => ({ ...value, warning: null as string | null })).catch((e) => ({
        rows: [],
        observability: { ...EMPTY_OBSERVABILITY },
        warning: `node_recipes snapshot degraded: ${String((e as Error)?.message || e).slice(0, 160)}`,
      })),
      latestStressPromise,
      stressHistoryPromise,
    ]);
    return NextResponse.json({
      ok: true,
      db_ready: true,
      worker: workerState.worker,
      workers: workerState.workers,
      queue: docs.queue,
      docs,
      observability: observabilitySnapshot.observability,
      observability_warning: observabilitySnapshot.warning,
      latest_stress: latestStress,
      stress_history: stressHistory,
      db_error: workerState.db_error,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const latestStress = await readLatestStressArtifact().catch(() => null);
    const stressHistory = await readStressHistorySummary().catch(() => null);
    return NextResponse.json({
      ok: true,
      db_ready: false,
      worker: null,
      queue: null,
      docs: null,
      observability: null,
      latest_stress: latestStress,
      stress_history: stressHistory,
      error: "worker-state GET crash: " + String((e as Error)?.message || e).slice(0, 180),
    }, { headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(req: NextRequest) {
  try {
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

    const { error } = await db.from(WORKER_STATE_TABLE).upsert(payload, { onConflict: "worker_id" });
    if (error) {
      const diagnostics = buildWorkerHeartbeatDiagnostics({
        dbError: error.message,
        workerSource: "queue_fallback",
        workerLastSeen: null,
      });
      return NextResponse.json({
        error: `railway_worker_states: ${error.message}`,
        issue: diagnostics?.issue || null,
        diagnostics,
      }, { status: 500 });
    }
    return NextResponse.json({ ok: true, worker_id, last_seen: now });
  } catch (e) {
    return NextResponse.json({ error: "worker-state POST crash: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
