import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { collectBalances } from "@/lib/factory/balances";
import { loadObserverPulse } from "@/lib/factory/observerPulse";
import { loadObservabilitySnapshot } from "@/lib/factory/runSnapshots";
import { readLatestStressArtifact, readStressHistorySummary } from "@/lib/factory/stabilityArtifacts";
import { buildWorkerHeartbeatDiagnostics, classifyWorkerHeartbeatIssue, loadWorkerDocs, loadWorkerSnapshot } from "@/lib/factory/workerState";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const BALANCE_THROTTLE_MS = 30 * 60 * 1000;

function isWorkerInfraIssue(issue: string | null) {
  return issue === "sender_missing" || issue === "fallback_active" || issue === "table_missing" || issue === "db_permissions";
}

function isWorkerInfraAlertCode(code: string | null) {
  return code === "worker_sender_missing"
    || code === "worker_state_table_missing"
    || code === "worker_state_db_permissions"
    || code === "worker_queue_fallback";
}

function isWorkerInfraAction(action: string | null) {
  return action === "start_worker_heartbeat_sender"
    || action === "apply_worker_state_table"
    || action === "repair_worker_state_permissions"
    || action === "repair_worker_heartbeat"
    || action === "open_worker_screen"
    || action === "inspect_worker_staleness";
}

function summarizeAlerts(input: {
  workerState: "unknown" | "alive" | "stale" | "dead";
  workerSource: "heartbeat_db" | "queue_fallback" | "unknown";
  workerDbError: string | null;
  workerIssue: string | null;
  lowServices: string[];
  failedRuns: number;
  warningRuns: number;
  criticFallbackRatio: number;
  criticDominantBasis: string | null;
  criticTopBasisReason: string | null;
}) {
  const alerts: { level: "ok" | "warn" | "error"; code: string; detail: string }[] = [];
  if (input.workerState === "dead") alerts.push({ level: "error", code: "worker_dead", detail: "worker heartbeat is dead" });
  else if (input.workerState === "stale") alerts.push({ level: "warn", code: "worker_stale", detail: "worker heartbeat is stale" });
  if (input.workerSource === "queue_fallback") {
    const code = input.workerIssue === "sender_missing"
      ? "worker_sender_missing"
      : input.workerIssue === "table_missing"
        ? "worker_state_table_missing"
        : input.workerIssue === "db_permissions"
          ? "worker_state_db_permissions"
          : "worker_queue_fallback";
    alerts.push({ level: input.workerIssue === "table_missing" ? "error" : "warn", code, detail: input.workerDbError || "worker snapshot derived from queue fallback" });
  }

  if (input.lowServices.length) {
    alerts.push({
      level: input.lowServices.length >= 2 ? "error" : "warn",
      code: "low_balances",
      detail: input.lowServices.join(", "),
    });
  }
  if (input.failedRuns > 0) alerts.push({ level: "warn", code: "run_failures", detail: `${input.failedRuns} failed runs in sample` });
  if (input.warningRuns > 0) alerts.push({ level: "warn", code: "run_warnings", detail: `${input.warningRuns} warning runs in sample` });
  if (input.criticFallbackRatio >= 0.5) {
    alerts.push({
      level: input.criticFallbackRatio >= 0.8 ? "error" : "warn",
      code: "critic_fallback_dominates",
      detail: `video-critic basis fallback ratio ${(input.criticFallbackRatio * 100).toFixed(0)}%`,
    });
  } else if (input.criticDominantBasis === "text") {
    alerts.push({ level: "warn", code: "critic_text_prefilter_dominates", detail: "quality signal is dominated by text prefilter instead of full-frame model critique" });
  }
  if (input.criticTopBasisReason === "upstream_unavailable") {
    alerts.push({ level: "error", code: "critic_upstream_unavailable", detail: "video-critic falls back because upstream model path is unavailable" });
  } else if (input.criticTopBasisReason === "timeout") {
    alerts.push({ level: "warn", code: "critic_timeout_pressure", detail: "video-critic frequently falls back because model calls time out" });
  } else if (input.criticTopBasisReason === "model_empty_response") {
    alerts.push({ level: "warn", code: "critic_model_empty_response", detail: "video-critic model path often returns empty responses" });
  } else if (input.criticTopBasisReason === "text_empty_response") {
    alerts.push({ level: "warn", code: "critic_text_empty_response", detail: "text-only critic path often returns empty responses" });
  }
  if (!alerts.length) alerts.push({ level: "ok", code: "healthy", detail: "no active ops alerts" });
  return alerts;
}

function buildSuggestedActions(input: {
  workerState: "unknown" | "alive" | "stale" | "dead";
  workerSource: "heartbeat_db" | "queue_fallback" | "unknown";
  workerDbError: string | null;
  workerIssue: string | null;
  lowServices: string[];
  failedRuns: number;
  warningRuns: number;
  topErrorCategory: string | null;
  criticFallbackRatio: number;
  criticDominantBasis: string | null;
  criticTopBasisReason: string | null;
}) {
  const actions: { priority: "p0" | "p1" | "p2"; action: string; reason: string }[] = [];
  if (input.workerState === "dead") {
    actions.push({ priority: "p0", action: "open_worker_screen", reason: "worker heartbeat is dead, check current task and last_seen first" });
  } else if (input.workerState === "stale") {
    actions.push({ priority: "p1", action: "inspect_worker_staleness", reason: "worker heartbeat is stale, verify whether execution is actually blocked" });
  }
  if (input.workerSource === "queue_fallback") {
    if (input.workerIssue === "sender_missing") {
      actions.push({ priority: "p1", action: "start_worker_heartbeat_sender", reason: "worker-state route has no live heartbeat sender; start lib/factory/workerHeartbeat.mjs for pulse/worker runtime" });
    } else if (input.workerIssue === "table_missing") {
      actions.push({ priority: "p0", action: "apply_worker_state_table", reason: input.workerDbError || "railway_worker_states is missing in Supabase schema cache" });
    } else if (input.workerIssue === "db_permissions") {
      actions.push({ priority: "p1", action: "repair_worker_state_permissions", reason: input.workerDbError || "worker heartbeat storage is blocked by DB permissions" });
    } else {
      actions.push({ priority: "p1", action: "repair_worker_heartbeat", reason: input.workerDbError || "worker state route fell back to queue-derived snapshot" });
    }
  }
  if (input.lowServices.length) {
    actions.push({ priority: input.lowServices.length >= 2 ? "p0" : "p1", action: "top_up_balances", reason: `low service balances: ${input.lowServices.join(", ")}` });
  }
  if (input.failedRuns > 0) {
    actions.push({ priority: "p1", action: "triage_failed_runs", reason: `${input.failedRuns} failed runs in current sample` });
  }
  if (input.topErrorCategory === "render") {
    actions.push({ priority: "p1", action: "inspect_render_path", reason: "render is the top error category in current sample" });
  } else if (input.topErrorCategory === "generation") {
    actions.push({ priority: "p1", action: "inspect_generation_path", reason: "generation is the top error category in current sample" });
  } else if (input.topErrorCategory === "db") {
    actions.push({ priority: "p0", action: "inspect_db_connectivity", reason: "database-related failures are leading current sample" });
  }
  if (input.warningRuns > 0) {
    actions.push({ priority: "p2", action: "review_warning_taxonomy", reason: `${input.warningRuns} warning runs may hide degradations before they become failures` });
  }
  if (input.criticFallbackRatio >= 0.5) {
    actions.push({
      priority: input.criticFallbackRatio >= 0.8 ? "p1" : "p2",
      action: "restore_video_critic_model_path",
      reason: `video-critic fallback ratio is ${(input.criticFallbackRatio * 100).toFixed(0)}% in the latest sample`,
    });
  } else if (input.criticDominantBasis === "text") {
    actions.push({
      priority: "p2",
      action: "review_text_prefilter_dependency",
      reason: "quality signal currently relies more on text prefilter than full-frame model critique",
    });
  }
  if (input.criticTopBasisReason === "upstream_unavailable") {
    actions.push({
      priority: "p0",
      action: "inspect_claude_upstream",
      reason: "video-critic most often falls back because the upstream model path is unavailable",
    });
  } else if (input.criticTopBasisReason === "timeout") {
    actions.push({
      priority: "p1",
      action: "inspect_video_critic_timeout_budget",
      reason: "video-critic fallbacks are led by timeouts; inspect timeout budget and provider latency",
    });
  } else if (input.criticTopBasisReason === "model_empty_response") {
    actions.push({
      priority: "p1",
      action: "inspect_video_critic_structured_output",
      reason: "video-critic model path often returns empty responses; inspect tool-use/text-parse extraction",
    });
  } else if (input.criticTopBasisReason === "text_empty_response") {
    actions.push({
      priority: "p2",
      action: "inspect_text_critic_fallback",
      reason: "text-only critic path often returns empty responses; inspect fallback prompt path",
    });
  }
  if (!actions.length) {
    actions.push({ priority: "p2", action: "continue_monitoring", reason: "no active alerts, keep observing ops snapshot" });
  }
  return actions.slice(0, 5);
}

function buildOpsStatus(input: {
  workerState: "unknown" | "alive" | "stale" | "dead";
  workerSource: "heartbeat_db" | "queue_fallback" | "unknown";
  workerIssue: string | null;
  lowServices: string[];
  failedRuns: number;
  warningRuns: number;
  topErrorCategory: string | null;
  criticFallbackRatio: number;
  criticDominantBasis: string | null;
  criticTopBasisReason: string | null;
}) {
  let level: "healthy" | "degraded" | "critical" = "healthy";
  const reasons: string[] = [];
  const elevate = (next: "degraded" | "critical") => {
    if (next === "critical") { level = "critical"; return; }
    if (level === "healthy") level = "degraded";
  };

  if (input.workerState === "dead") {
    elevate("critical");
    reasons.push("worker dead");
  } else if (input.workerState === "stale") {
    elevate("degraded");
    reasons.push("worker stale");
  }
  if (input.workerSource === "queue_fallback" && !isWorkerInfraIssue(input.workerIssue)) {
    elevate("degraded");
    reasons.push("worker heartbeat fallback");
  }
  if (input.lowServices.length >= 2) {
    elevate("critical");
    reasons.push("multiple low balances");
  } else if (input.lowServices.length === 1) {
    elevate("degraded");
    reasons.push(`low balance: ${input.lowServices[0]}`);
  }
  if (input.topErrorCategory === "db") {
    elevate("critical");
    reasons.push("db failures lead sample");
  } else if (input.failedRuns > 0 || input.topErrorCategory === "render" || input.topErrorCategory === "generation") {
    elevate("degraded");
    if (input.failedRuns > 0) reasons.push(`${input.failedRuns} failed runs`);
    if (input.topErrorCategory === "render") reasons.push("render issues");
    if (input.topErrorCategory === "generation") reasons.push("generation issues");
  } else if (input.warningRuns > 0) {
    elevate("degraded");
    reasons.push(`${input.warningRuns} warning runs`);
  }
  if (input.criticFallbackRatio >= 0.8) {
    elevate("degraded");
    reasons.push("critic fallback dominates");
  } else if (input.criticDominantBasis === "text") {
    elevate("degraded");
    reasons.push("critic mostly text-only");
  }
  if (input.criticTopBasisReason === "upstream_unavailable") {
    elevate("critical");
    reasons.push("critic upstream unavailable");
  } else if (input.criticTopBasisReason === "timeout") {
    elevate("degraded");
    reasons.push("critic timeouts");
  } else if (input.criticTopBasisReason === "model_empty_response") {
    elevate("degraded");
    reasons.push("critic empty model responses");
  }

  if (!reasons.length) reasons.push("no active ops issues");
  return {
    level,
    summary: reasons.slice(0, 3).join(" · "),
  };
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
        workers: [],
        queue: docs.queue,
        docs,
        balances: null,
        observability: null,
        latest_stress: await latestStressPromise,
        stress_history: await stressHistoryPromise,
        alerts: [{ level: "error", code: "db_missing", detail: "Supabase is not configured" }],
        generated_at: new Date().toISOString(),
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const warnings: string[] = [];
    const [workerState, balancesResult, observabilitySnapshotResult, observer, latestStress, stressHistory] = await Promise.all([
      loadWorkerSnapshot(db, docs.queue),
      collectBalances(db, { persist: true, throttleMs: BALANCE_THROTTLE_MS }).catch((error) => {
        warnings.push("balances unavailable: " + String((error as Error)?.message || error).slice(0, 160));
        return [];
      }),
      loadObservabilitySnapshot(db, 48).catch((error) => {
        warnings.push("observability unavailable: " + String((error as Error)?.message || error).slice(0, 160));
        return { observability: null };
      }),
      loadObserverPulse(db).catch((error) => {
        warnings.push("observer pulse unavailable: " + String((error as Error)?.message || error).slice(0, 160));
        return { ok: true, partial: true, updated_at: new Date().toISOString(), error: String((error as Error)?.message || error).slice(0, 160) };
      }),
      latestStressPromise,
      stressHistoryPromise,
    ]);
    const balances = balancesResult;
    const observability = observabilitySnapshotResult.observability || {
      total: 0,
      running: 0,
      done: 0,
      failed: 0,
      warning_runs: 0,
      top_error_categories: [],
      quality_signal: null,
      recent_runs: [],
    };
    const lowServices = balances.filter((s) => s.low).map((s) => s.service);
    const workerIssue = classifyWorkerHeartbeatIssue(
      workerState.db_error,
      workerState.worker?.source || "unknown",
      workerState.worker?.last_seen || null,
    );
    const heartbeat_diagnostics = buildWorkerHeartbeatDiagnostics({
      dbError: workerState.db_error,
      workerSource: workerState.worker?.source || "unknown",
      workerLastSeen: workerState.worker?.last_seen || null,
    });
    const alerts = summarizeAlerts({
      workerState: workerState.worker?.liveness?.state || "unknown",
      workerSource: workerState.worker?.source || "unknown",
      workerDbError: workerState.db_error,
      workerIssue,
      lowServices,
      failedRuns: Number(observability.failed || 0),
      warningRuns: Number(observability.warning_runs || 0),
      criticFallbackRatio: Number((observability.quality_signal as { fallback_ratio?: unknown } | null)?.fallback_ratio || 0),
      criticDominantBasis: String((observability.quality_signal as { dominant_basis?: unknown } | null)?.dominant_basis || "") || null,
      criticTopBasisReason: String((observability.quality_signal as { top_basis_reason?: unknown } | null)?.top_basis_reason || "") || null,
    });
    const topErrorCategory = Array.isArray(observability.top_error_categories) && observability.top_error_categories[0]
      ? String((observability.top_error_categories[0] as { category?: unknown }).category || "")
      : null;
    const suggested_actions = buildSuggestedActions({
      workerState: workerState.worker?.liveness?.state || "unknown",
      workerSource: workerState.worker?.source || "unknown",
      workerDbError: workerState.db_error,
      workerIssue,
      lowServices,
      failedRuns: Number(observability.failed || 0),
      warningRuns: Number(observability.warning_runs || 0),
      topErrorCategory,
      criticFallbackRatio: Number((observability.quality_signal as { fallback_ratio?: unknown } | null)?.fallback_ratio || 0),
      criticDominantBasis: String((observability.quality_signal as { dominant_basis?: unknown } | null)?.dominant_basis || "") || null,
      criticTopBasisReason: String((observability.quality_signal as { top_basis_reason?: unknown } | null)?.top_basis_reason || "") || null,
    });
    const ops_status = buildOpsStatus({
      workerState: workerState.worker?.liveness?.state || "unknown",
      workerSource: workerState.worker?.source || "unknown",
      workerIssue,
      lowServices,
      failedRuns: Number(observability.failed || 0),
      warningRuns: Number(observability.warning_runs || 0),
      topErrorCategory,
      criticFallbackRatio: Number((observability.quality_signal as { fallback_ratio?: unknown } | null)?.fallback_ratio || 0),
      criticDominantBasis: String((observability.quality_signal as { dominant_basis?: unknown } | null)?.dominant_basis || "") || null,
      criticTopBasisReason: String((observability.quality_signal as { top_basis_reason?: unknown } | null)?.top_basis_reason || "") || null,
    });

    const worker_infra_alerts = alerts.filter((alert) => isWorkerInfraAlertCode(alert.code || null));
    const factory_alerts = alerts.filter((alert) => !isWorkerInfraAlertCode(alert.code || null));
    const worker_infra_actions = suggested_actions.filter((action) => isWorkerInfraAction(action.action || null));
    const factory_actions = suggested_actions.filter((action) => !isWorkerInfraAction(action.action || null));

    return NextResponse.json({
      ok: true,
      db_ready: true,
      worker: workerState.worker,
      workers: workerState.workers,
      queue: docs.queue,
      docs,
      balances: {
        services: balances,
        low: lowServices,
        updated_at: new Date().toISOString(),
      },
      observer,
      observability,
      latest_stress: latestStress,
      stress_history: stressHistory,
      warnings,
      alerts,
      factory_alerts,
      worker_infra_alerts,
      suggested_actions,
      factory_actions,
      worker_infra_actions,
      ops_status,
      heartbeat_diagnostics,
      db_error: workerState.db_error,
      generated_at: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const latestStress = await readLatestStressArtifact().catch(() => null);
    const stressHistory = await readStressHistorySummary().catch(() => null);
    return NextResponse.json({
      ok: false,
      error: "ops crash: " + String((e as Error)?.message || e).slice(0, 160),
      db_ready: false,
      worker: null,
      workers: [],
      queue: null,
      docs: null,
      balances: null,
      observability: null,
      latest_stress: latestStress,
      stress_history: stressHistory,
      alerts: [{ level: "error", code: "ops_crash", detail: String((e as Error)?.message || e).slice(0, 160) }],
      suggested_actions: [{ priority: "p1", action: "inspect_ops_endpoint", reason: "ops endpoint returned route-level crash contract" }],
      generated_at: new Date().toISOString(),
    }, { status: 500 });
  }
}
