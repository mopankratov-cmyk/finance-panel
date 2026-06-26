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
const EMPTY_OBSERVABILITY: Record<string, unknown> = {
  sample_runs: 0,
  active_sample_runs: 0,
  running: 0,
  stale_running: 0,
  warning_runs: 0,
  failed: 0,
  legacy_warning_runs: 0,
  legacy_failed_runs: 0,
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

function summarizeAlerts(input: {
  workerState: "unknown" | "alive" | "stale" | "dead";
  workerSource: "heartbeat_db" | "queue_fallback" | "unknown";
  workerDbError: string | null;
  workerIssue: string | null;
  lowServices: string[];
  staleRunning: number;
  failedRuns: number;
  warningRuns: number;
  legacyFailedRuns: number;
  legacyWarningRuns: number;
  criticFallbackRatio: number;
  criticDominantBasis: string | null;
  criticTopBasisReason: string | null;
  observabilityWarning: string | null;
}) {
  const alerts: { level: "ok" | "warn" | "error"; code: string; detail: string }[] = [];
  if (input.workerState === "dead") alerts.push({ level: "error", code: "worker_dead", detail: "пульс завода потерян" });
  else if (input.workerState === "stale") alerts.push({ level: "warn", code: "worker_stale", detail: "пульс завода давно не обновлялся" });
  if (input.workerSource === "queue_fallback") {
    const code = input.workerIssue === "sender_missing"
      ? "worker_sender_missing"
      : input.workerIssue === "table_missing"
        ? "worker_state_table_missing"
        : input.workerIssue === "db_permissions"
          ? "worker_state_db_permissions"
          : "worker_queue_fallback";
    alerts.push({ level: "warn", code, detail: input.workerDbError || "снимок завода собран из резервного источника" });
  }

  if (input.lowServices.length) {
    alerts.push({
      level: input.lowServices.length >= 2 ? "error" : "warn",
      code: "low_balances",
      detail: input.lowServices.join(", "),
    });
  }
  if (input.staleRunning > 0) alerts.push({ level: "warn", code: "stale_running_runs", detail: `подвисших прогонов: ${input.staleRunning}` });
  if (input.failedRuns > 0) alerts.push({ level: "warn", code: "run_failures", detail: `сбоев в текущей выборке: ${input.failedRuns}` });
  if (input.warningRuns > 0) alerts.push({ level: "warn", code: "run_warnings", detail: `прогонов с предупреждениями: ${input.warningRuns}` });
  if (input.failedRuns === 0 && input.warningRuns === 0 && (input.legacyFailedRuns > 0 || input.legacyWarningRuns > 0)) {
    alerts.push({
      level: "ok",
      code: "legacy_incidents_only",
      detail: `в архиве осталось сбоев: ${input.legacyFailedRuns}, предупреждений: ${input.legacyWarningRuns}`,
    });
  }
  if (input.criticFallbackRatio >= 0.5) {
    alerts.push({
      level: input.criticFallbackRatio >= 0.8 ? "error" : "warn",
      code: "critic_fallback_dominates",
      detail: `видео-критик часто уходит в резерв: ${(input.criticFallbackRatio * 100).toFixed(0)}%`,
    });
  } else if (input.criticDominantBasis === "text") {
    alerts.push({ level: "warn", code: "critic_text_prefilter_dominates", detail: "сигнал качества чаще строится по тексту, а не по кадрам" });
  }
  if (input.criticTopBasisReason === "upstream_unavailable") {
    alerts.push({ level: "error", code: "critic_upstream_unavailable", detail: "видео-критик уходит в резерв: модельный путь недоступен" });
  } else if (input.criticTopBasisReason === "timeout") {
    alerts.push({ level: "warn", code: "critic_timeout_pressure", detail: "видео-критик часто упирается в таймауты" });
  } else if (input.criticTopBasisReason === "model_empty_response") {
    alerts.push({ level: "warn", code: "critic_model_empty_response", detail: "модельный путь видео-критика часто возвращает пустой ответ" });
  } else if (input.criticTopBasisReason === "text_empty_response") {
    alerts.push({ level: "warn", code: "critic_text_empty_response", detail: "текстовый резерв видео-критика часто возвращает пустой ответ" });
  }
  if (input.observabilityWarning) {
    alerts.push({ level: "warn", code: "observability_partial", detail: input.observabilityWarning });
  }
  if (!alerts.length) alerts.push({ level: "ok", code: "healthy", detail: "активных предупреждений нет" });
  return alerts;
}

function buildSuggestedActions(input: {
  workerState: "unknown" | "alive" | "stale" | "dead";
  workerSource: "heartbeat_db" | "queue_fallback" | "unknown";
  workerDbError: string | null;
  workerIssue: string | null;
  lowServices: string[];
  staleRunning: number;
  failedRuns: number;
  warningRuns: number;
  legacyFailedRuns: number;
  legacyWarningRuns: number;
  topErrorCategory: string | null;
  criticFallbackRatio: number;
  criticDominantBasis: string | null;
  criticTopBasisReason: string | null;
  observabilityWarning: string | null;
}) {
  const actions: { priority: "p0" | "p1" | "p2"; action: string; reason: string }[] = [];
  if (input.workerState === "dead") {
    actions.push({ priority: "p0", action: "open_worker_screen", reason: "пульс завода потерян; сначала проверь живой прогон и последний сигнал" });
  } else if (input.workerState === "stale") {
    actions.push({ priority: "p1", action: "inspect_worker_staleness", reason: "пульс давно не обновлялся; проверь, действительно ли прогон заблокирован" });
  }
  if (input.workerSource === "queue_fallback") {
    if (input.workerIssue === "sender_missing") {
      actions.push({ priority: "p1", action: "start_worker_heartbeat_sender", reason: "нет живого передатчика пульса; запусти lib/factory/workerHeartbeat.mjs на Railway worker" });
    } else if (input.workerIssue === "table_missing") {
      actions.push({ priority: "p2", action: "enable_optional_worker_heartbeat", reason: input.workerDbError || "опциональная таблица пульса не поднята; работает резервный снимок" });
    } else if (input.workerIssue === "db_permissions") {
      actions.push({ priority: "p1", action: "repair_worker_state_permissions", reason: input.workerDbError || "запись пульса заблокирована правами БД" });
    } else {
      actions.push({ priority: "p1", action: "repair_worker_heartbeat", reason: input.workerDbError || "статус завода собран из резервного снимка" });
    }
  }
  if (input.lowServices.length) {
    actions.push({ priority: input.lowServices.length >= 2 ? "p0" : "p1", action: "top_up_balances", reason: `низкие балансы сервисов: ${input.lowServices.join(", ")}` });
  }
  if (input.staleRunning > 0) {
    actions.push({ priority: "p1", action: "inspect_stuck_runs", reason: `подвисших прогонов: ${input.staleRunning}` });
  }
  if (input.failedRuns > 0) {
    actions.push({ priority: "p1", action: "triage_failed_runs", reason: `сбоев в текущей выборке: ${input.failedRuns}` });
  } else if (input.legacyFailedRuns > 0) {
    actions.push({ priority: "p2", action: "archive_legacy_failed_runs", reason: `архивных сбоев: ${input.legacyFailedRuns}; разбирай отдельно от живых прогонов` });
  }
  if (input.topErrorCategory === "render") {
    actions.push({ priority: "p1", action: "inspect_render_path", reason: "рендер лидирует среди текущих сбоев" });
  } else if (input.topErrorCategory === "generation") {
    actions.push({ priority: "p1", action: "inspect_generation_path", reason: "генерация лидирует среди текущих сбоев" });
  } else if (input.topErrorCategory === "db") {
    actions.push({ priority: "p0", action: "inspect_db_connectivity", reason: "ошибки БД лидируют среди текущих сбоев" });
  }
  if (input.warningRuns > 0) {
    actions.push({ priority: "p2", action: "review_warning_taxonomy", reason: `прогонов с предупреждениями: ${input.warningRuns}; проверь, не прячется ли будущий сбой` });
  } else if (input.legacyWarningRuns > 0) {
    actions.push({ priority: "p2", action: "review_legacy_warning_history", reason: `архивных предупреждений: ${input.legacyWarningRuns}; это не живой инцидент` });
  }
  if (input.criticFallbackRatio >= 0.5) {
    actions.push({
      priority: input.criticFallbackRatio >= 0.8 ? "p1" : "p2",
      action: "restore_video_critic_model_path",
      reason: `видео-критик уходит в резерв в ${(input.criticFallbackRatio * 100).toFixed(0)}% последних проверок`,
    });
  } else if (input.criticDominantBasis === "text") {
    actions.push({
      priority: "p2",
      action: "review_text_prefilter_dependency",
      reason: "сигнал качества сейчас чаще строится по тексту, а не по кадрам",
    });
  }
  if (input.criticTopBasisReason === "upstream_unavailable") {
    actions.push({
      priority: "p0",
      action: "inspect_claude_upstream",
      reason: "видео-критик чаще всего уходит в резерв из-за недоступного модельного пути",
    });
  } else if (input.criticTopBasisReason === "timeout") {
    actions.push({
      priority: "p1",
      action: "inspect_video_critic_timeout_budget",
      reason: "видео-критик чаще всего падает по таймаутам; проверь бюджет ожидания и задержку провайдера",
    });
  } else if (input.criticTopBasisReason === "model_empty_response") {
    actions.push({
      priority: "p1",
      action: "inspect_video_critic_structured_output",
      reason: "модельный путь видео-критика часто возвращает пустой ответ; проверь разбор structured output",
    });
  } else if (input.criticTopBasisReason === "text_empty_response") {
    actions.push({
      priority: "p2",
      action: "inspect_text_critic_fallback",
      reason: "текстовый резерв видео-критика часто возвращает пустой ответ; проверь резервный промпт",
    });
  }
  if (input.observabilityWarning) {
    actions.push({
      priority: "p2",
      action: "inspect_observability_snapshot",
      reason: input.observabilityWarning,
    });
  }
  if (!actions.length) {
    actions.push({ priority: "p2", action: "continue_monitoring", reason: "активных предупреждений нет; продолжай наблюдать снимок завода" });
  }
  return actions.slice(0, 5);
}

function buildOpsStatus(input: {
  workerState: "unknown" | "alive" | "stale" | "dead";
  workerSource: "heartbeat_db" | "queue_fallback" | "unknown";
  workerIssue: string | null;
  lowServices: string[];
  staleRunning: number;
  failedRuns: number;
  warningRuns: number;
  legacyFailedRuns: number;
  legacyWarningRuns: number;
  topErrorCategory: string | null;
  criticFallbackRatio: number;
  criticDominantBasis: string | null;
  criticTopBasisReason: string | null;
  observabilityWarning: string | null;
}) {
  let level: "healthy" | "degraded" | "critical" = "healthy";
  const reasons: string[] = [];
  const elevate = (next: "degraded" | "critical") => {
    if (next === "critical") { level = "critical"; return; }
    if (level === "healthy") level = "degraded";
  };

  if (input.workerState === "dead") {
    elevate("critical");
    reasons.push("пульс потерян");
  } else if (input.workerState === "stale") {
    elevate("degraded");
    reasons.push("пульс молчит");
  }
  if (input.workerSource === "queue_fallback") {
    if (input.workerIssue === "table_missing") {
      reasons.push("пульс через резерв");
    } else {
      elevate("degraded");
      reasons.push(input.workerIssue === "sender_missing" ? "нет передатчика пульса" : "резервный снимок пульса");
    }
  }
  if (input.lowServices.length >= 2) {
    elevate("critical");
    reasons.push("несколько низких балансов");
  } else if (input.lowServices.length === 1) {
    elevate("degraded");
    reasons.push(`низкий баланс: ${input.lowServices[0]}`);
  }
  if (input.staleRunning > 0) {
    elevate("degraded");
    reasons.push(`подвисших прогонов: ${input.staleRunning}`);
  }
  if (input.topErrorCategory === "db") {
    elevate("critical");
    reasons.push("сбои БД лидируют");
  } else if (input.failedRuns > 0 || input.topErrorCategory === "render" || input.topErrorCategory === "generation") {
    elevate("degraded");
    if (input.failedRuns > 0) reasons.push(`сбоев: ${input.failedRuns}`);
    if (input.topErrorCategory === "render") reasons.push("проблемы рендера");
    if (input.topErrorCategory === "generation") reasons.push("проблемы генерации");
  } else if (input.warningRuns > 0) {
    elevate("degraded");
    reasons.push(`предупреждений: ${input.warningRuns}`);
  } else if (input.legacyFailedRuns > 0 || input.legacyWarningRuns > 0) {
    reasons.push("есть архивные инциденты");
  }
  if (input.criticFallbackRatio >= 0.8) {
    elevate("degraded");
    reasons.push("критик часто в резерве");
  } else if (input.criticDominantBasis === "text") {
    elevate("degraded");
    reasons.push("критик чаще по тексту");
  }
  if (input.criticTopBasisReason === "upstream_unavailable") {
    elevate("critical");
    reasons.push("модель критика недоступна");
  } else if (input.criticTopBasisReason === "timeout") {
    elevate("degraded");
    reasons.push("таймауты критика");
  } else if (input.criticTopBasisReason === "model_empty_response") {
    elevate("degraded");
    reasons.push("пустые ответы критика");
  }
  if (input.observabilityWarning) {
    elevate("degraded");
    reasons.push("снимок неполный");
  }

  if (!reasons.length) reasons.push("активных проблем нет");
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
        alerts: [{ level: "error", code: "db_missing", detail: "Supabase не настроен" }],
        generated_at: new Date().toISOString(),
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const [workerState, balances, observabilitySnapshot, observer, latestStress, stressHistory] = await Promise.all([
      loadWorkerSnapshot(db, docs.queue),
      collectBalances(db, { persist: true, throttleMs: BALANCE_THROTTLE_MS }),
      loadObservabilitySnapshot(db, 48).then((value) => ({ ...value, warning: null as string | null })).catch((e) => ({
        rows: [],
        observability: { ...EMPTY_OBSERVABILITY },
        warning: `node_recipes snapshot degraded: ${String((e as Error)?.message || e).slice(0, 160)}`,
      })),
      loadObserverPulse(db),
      latestStressPromise,
      stressHistoryPromise,
    ]);
    const observability = observabilitySnapshot.observability;
    const observabilityWarning = observabilitySnapshot.warning;
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
      staleRunning: Number((observability as { stale_running?: unknown } | null)?.stale_running || 0),
      failedRuns: Number(observability.failed || 0),
      warningRuns: Number(observability.warning_runs || 0),
      legacyFailedRuns: Number((observability as { legacy_failed_runs?: unknown } | null)?.legacy_failed_runs || 0),
      legacyWarningRuns: Number((observability as { legacy_warning_runs?: unknown } | null)?.legacy_warning_runs || 0),
      criticFallbackRatio: Number((observability.quality_signal as { fallback_ratio?: unknown } | null)?.fallback_ratio || 0),
      criticDominantBasis: String((observability.quality_signal as { dominant_basis?: unknown } | null)?.dominant_basis || "") || null,
      criticTopBasisReason: String((observability.quality_signal as { top_basis_reason?: unknown } | null)?.top_basis_reason || "") || null,
      observabilityWarning,
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
      staleRunning: Number((observability as { stale_running?: unknown } | null)?.stale_running || 0),
      failedRuns: Number(observability.failed || 0),
      warningRuns: Number(observability.warning_runs || 0),
      legacyFailedRuns: Number((observability as { legacy_failed_runs?: unknown } | null)?.legacy_failed_runs || 0),
      legacyWarningRuns: Number((observability as { legacy_warning_runs?: unknown } | null)?.legacy_warning_runs || 0),
      topErrorCategory,
      criticFallbackRatio: Number((observability.quality_signal as { fallback_ratio?: unknown } | null)?.fallback_ratio || 0),
      criticDominantBasis: String((observability.quality_signal as { dominant_basis?: unknown } | null)?.dominant_basis || "") || null,
      criticTopBasisReason: String((observability.quality_signal as { top_basis_reason?: unknown } | null)?.top_basis_reason || "") || null,
      observabilityWarning,
    });
    const ops_status = buildOpsStatus({
      workerState: workerState.worker?.liveness?.state || "unknown",
      workerSource: workerState.worker?.source || "unknown",
      workerIssue,
      lowServices,
      staleRunning: Number((observability as { stale_running?: unknown } | null)?.stale_running || 0),
      failedRuns: Number(observability.failed || 0),
      warningRuns: Number(observability.warning_runs || 0),
      legacyFailedRuns: Number((observability as { legacy_failed_runs?: unknown } | null)?.legacy_failed_runs || 0),
      legacyWarningRuns: Number((observability as { legacy_warning_runs?: unknown } | null)?.legacy_warning_runs || 0),
      topErrorCategory,
      criticFallbackRatio: Number((observability.quality_signal as { fallback_ratio?: unknown } | null)?.fallback_ratio || 0),
      criticDominantBasis: String((observability.quality_signal as { dominant_basis?: unknown } | null)?.dominant_basis || "") || null,
      criticTopBasisReason: String((observability.quality_signal as { top_basis_reason?: unknown } | null)?.top_basis_reason || "") || null,
      observabilityWarning,
    });

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
      observability_warning: observabilityWarning,
      latest_stress: latestStress,
      stress_history: stressHistory,
      alerts,
      suggested_actions,
      ops_status,
      heartbeat_diagnostics,
      db_error: workerState.db_error,
      generated_at: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const latestStress = await readLatestStressArtifact().catch(() => null);
    const stressHistory = await readStressHistorySummary().catch(() => null);
    return NextResponse.json({
      ok: true,
      partial: true,
      warning: "сводка завода временно недоступна: " + String((e as Error)?.message || e).slice(0, 160),
      db_ready: false,
      worker: null,
      workers: [],
      queue: null,
      docs: null,
      balances: null,
      observability: EMPTY_OBSERVABILITY,
      latest_stress: latestStress,
      stress_history: stressHistory,
      alerts: [{ level: "error", code: "ops_crash", detail: String((e as Error)?.message || e).slice(0, 160) }],
      suggested_actions: [{ priority: "p1", action: "inspect_ops_endpoint", reason: "сводка завода упала до сборки статуса" }],
      ops_status: { level: "degraded", summary: "пульс временно недоступен", reasons: ["сводка завода временно недоступна"] },
      heartbeat_diagnostics: null,
      generated_at: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  }
}
