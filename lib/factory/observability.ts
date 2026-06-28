export type RunSummary = {
  started_at: unknown;
  finished_at: unknown;
  total_ms: number | null;
  steps_total: number;
  steps_done: number;
  steps_warning: number;
  steps_error: number;
  active_step: string | null;
  last_step: string | null;
  last_status: string | null;
};

export type RecentRunPoint = {
  recipe_id: number | null;
  created_at: string | null;
  target_platform: string | null;
  status: string;
  total_ms: number | null;
  error_category: string | null;
  warnings_count: number;
};

export type StatusSeriesPoint = {
  bucket: string;
  total: number;
  passed: number;
  warning: number;
  failed: number;
  running: number;
};

export type StepDurationSeriesPoint = {
  bucket: string;
  step: string;
  avg_ms: number | null;
  samples: number;
};

export type FailureDiagnostics = {
  issue: string;
  category: string | null;
  sample_error: string | null;
  next_step: string;
  action: string;
};

export type StabilitySnapshot = {
  window_size: number;
  sample_size: number;
  successful_runs: number;
  warning_runs: number;
  failed_runs: number;
  running_runs: number;
  success_streak: number;
  target_successes: number;
  target_met: boolean;
};

export type QualitySignalSnapshot = {
  sample_size: number;
  model_runs: number;
  text_runs: number;
  fallback_runs: number;
  missing_basis: number;
  dominant_basis: string | null;
  fallback_ratio: number;
  top_basis_reason: string | null;
};

export type StabilityReport = StabilitySnapshot & {
  generated_at: string;
  incident_runs: IncidentRunPoint[];
  recent_runs: RecentRunPoint[];
  failure_diagnostics: FailureDiagnostics | null;
};

export type IncidentRunPoint = {
  recipe_id: number | null;
  run_id: string | null;
  created_at: string | null;
  target_platform: string | null;
  status: string;
  last_step: string | null;
  last_status: string | null;
  total_ms: number | null;
  error_category: string | null;
  error: string | null;
  warnings_count: number;
};

type LogEntry = {
  started_at?: unknown;
  finished_at?: unknown;
  step?: unknown;
  status?: unknown;
};

type RunPlanLike = {
  execution_log?: unknown;
  error?: unknown;
  warnings?: unknown;
};

function msBetween(startedAt: unknown, finishedAt: unknown): number | null {
  const start = Date.parse(String(startedAt || ""));
  const finish = Date.parse(String(finishedAt || ""));
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) return null;
  return finish - start;
}

function bucketHourKey(value: unknown): string | null {
  const ms = Date.parse(String(value || ""));
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 13) + ":00";
}

function isSuccessfulRun(status: string, summary: RunSummary): boolean {
  if (status === "running" || status === "run_fail") return false;
  if (summary.last_step === "failed" || summary.last_status === "error") return false;
  return !!summary.finished_at || summary.last_step === "done";
}

export function buildRunSummary(plan: RunPlanLike | null | undefined): RunSummary {
  const log = Array.isArray(plan?.execution_log) ? plan.execution_log as LogEntry[] : [];
  const first = log[0] || null;
  const last = log.length ? log[log.length - 1] : null;
  const startedAt = first?.started_at || null;
  const finishedAt = last?.finished_at || null;
  const active = log.find((e) => e && e.status === "running") || null;
  const totalMs = startedAt ? ((finishedAt ? msBetween(startedAt, finishedAt) : (Date.now() - Date.parse(String(startedAt)))) || null) : null;
  return {
    started_at: startedAt,
    finished_at: finishedAt,
    total_ms: totalMs,
    steps_total: log.length,
    steps_done: log.filter((e) => e?.status === "done").length,
    steps_warning: log.filter((e) => e?.status === "warning").length,
    steps_error: log.filter((e) => e?.status === "error").length,
    active_step: active?.step ? String(active.step) : null,
    last_step: last?.step ? String(last.step) : null,
    last_status: last?.status ? String(last.status) : null,
  };
}

export function classifyWarningReason(reason: string): string {
  const s = reason.toLowerCase();
  if (s.includes("video-critic")) return "critic";
  if (s.includes("artifact-check")) return "artifact";
  if (s.includes("gen-save") || s.includes("catalog")) return "catalog";
  if (s.includes("render") || s.includes("shotstack") || s.includes("remotion")) return "render";
  if (s.includes("extractframes")) return "frames";
  if (s.includes("timeout")) return "timeout";
  if (s.includes("otk")) return "quality";
  return "other";
}

export function classifyErrorReason(reason: string): string {
  const s = reason.toLowerCase();
  if (!s) return "other";
  if (s.includes("recipe_id") || (s.includes("recipe") && s.includes("не найден"))) return "input";
  if (s.includes("supabase") || s.includes("db") || s.includes("database")) return "db";
  if (s.includes("лимит запусков") || s.includes("стоп для бюджета") || s.includes("budget")) return "budget";
  if (s.includes("timeout")) return "timeout";
  if (s.includes("render") || s.includes("shotstack") || s.includes("remotion") || s.includes("output_url")) return "render";
  if (s.includes("otk") || s.includes("critic") || s.includes("artifact-check")) return "quality";
  if (s.includes("catalog") || s.includes("gen-save") || s.includes("save")) return "storage";
  if (s.includes("все ноды генерации упали") || s.includes("/api/factory/") || s.includes("generation")) return "generation";
  return "other";
}

export function buildObservability(rows: Record<string, unknown>[]) {
  const stepMap = new Map<string, { total: number; done: number; warning: number; error: number; total_ms: number; samples: number }>();
  const stepSeriesMap = new Map<string, { bucket: string; step: string; total_ms: number; samples: number }>();
  const warningMap = new Map<string, number>();
  const warningCategoryMap = new Map<string, number>();
  const errorMap = new Map<string, number>();
  const errorCategoryMap = new Map<string, number>();
  const recentRuns: RecentRunPoint[] = [];
  const incidentRuns: IncidentRunPoint[] = [];
  const stabilityWindow: { status: string; success: boolean }[] = [];
  const qualityBasisWindow: { basis: string; reason: string | null }[] = [];
  const statusSeriesMap = new Map<string, StatusSeriesPoint>();
  let running = 0;
  let warningRuns = 0;
  let failed = 0;

  for (const raw of rows) {
    const status = String(raw.status || "");
    if (status === "running") running++;
    if (status === "warning") warningRuns++;
    if (status === "run_fail") failed++;

    const plan = (raw.run_plan && typeof raw.run_plan === "object") ? raw.run_plan as Record<string, unknown> : {};
    const planError = String(plan.error || "").trim().slice(0, 180);
    if (planError) {
      errorMap.set(planError, (errorMap.get(planError) || 0) + 1);
      const category = classifyErrorReason(planError);
      errorCategoryMap.set(category, (errorCategoryMap.get(category) || 0) + 1);
    }
    const warnings = Array.isArray(plan.warnings) ? plan.warnings : [];
    const otk = (plan.otk && typeof plan.otk === "object") ? plan.otk as Record<string, unknown> : null;
    const otkBasis = otk?.basis ? String(otk.basis).trim() : "";
    if (otkBasis) {
      qualityBasisWindow.push({
        basis: otkBasis,
        reason: otk?.basis_reason ? String(otk.basis_reason).trim() : null,
      });
    }
    warnings.forEach((w) => {
      const key = String(w).trim().slice(0, 120);
      if (!key) return;
      warningMap.set(key, (warningMap.get(key) || 0) + 1);
      const category = classifyWarningReason(key);
      warningCategoryMap.set(category, (warningCategoryMap.get(category) || 0) + 1);
    });
    const summary = buildRunSummary(plan);
    stabilityWindow.push({
      status,
      success: isSuccessfulRun(status, summary),
    });
    recentRuns.push({
      recipe_id: Number(raw.id) || null,
      created_at: raw.created_at ? String(raw.created_at) : null,
      target_platform: plan.target_platform ? String(plan.target_platform) : null,
      status,
      total_ms: summary.total_ms,
      error_category: planError ? classifyErrorReason(planError) : null,
      warnings_count: warnings.length,
    });
    if (status === "run_fail" || status === "warning") {
      incidentRuns.push({
        recipe_id: Number(raw.id) || null,
        run_id: plan.run_id ? String(plan.run_id) : null,
        created_at: raw.created_at ? String(raw.created_at) : null,
        target_platform: plan.target_platform ? String(plan.target_platform) : null,
        status,
        last_step: summary.last_step,
        last_status: summary.last_status,
        total_ms: summary.total_ms,
        error_category: planError ? classifyErrorReason(planError) : null,
        error: planError || null,
        warnings_count: warnings.length,
      });
    }
    const bucket = bucketHourKey(raw.created_at);
    if (bucket) {
      const point = statusSeriesMap.get(bucket) || { bucket, total: 0, passed: 0, warning: 0, failed: 0, running: 0 };
      point.total++;
      if (status === "run_fail") point.failed++;
      else if (status === "warning") point.warning++;
      else if (status === "running") point.running++;
      else point.passed++;
      statusSeriesMap.set(bucket, point);
    }
    const log = Array.isArray(plan.execution_log) ? plan.execution_log as Record<string, unknown>[] : [];
    log.forEach((entry) => {
      const step = String(entry.step || "").trim();
      if (!step) return;
      const row = stepMap.get(step) || { total: 0, done: 0, warning: 0, error: 0, total_ms: 0, samples: 0 };
      row.total++;
      const stepStatus = String(entry.status || "");
      if (stepStatus === "done") row.done++;
      else if (stepStatus === "warning") row.warning++;
      else if (stepStatus === "error") row.error++;
      const dur = msBetween(entry.started_at, entry.finished_at);
      if (dur != null) {
        row.total_ms += dur;
        row.samples++;
        const seriesBucket = bucketHourKey(entry.started_at) || bucketHourKey(raw.created_at);
        if (seriesBucket) {
          const seriesKey = `${seriesBucket}__${step}`;
          const seriesRow = stepSeriesMap.get(seriesKey) || { bucket: seriesBucket, step, total_ms: 0, samples: 0 };
          seriesRow.total_ms += dur;
          seriesRow.samples++;
          stepSeriesMap.set(seriesKey, seriesRow);
        }
      }
      stepMap.set(step, row);
    });
  }

  const slowest_steps = Array.from(stepMap.entries())
    .map(([step, v]) => ({
      step,
      total: v.total,
      done: v.done,
      warning: v.warning,
      error: v.error,
      avg_ms: v.samples ? Math.round(v.total_ms / v.samples) : null,
    }))
    .sort((a, b) => (b.avg_ms || 0) - (a.avg_ms || 0))
    .slice(0, 5);

  const top_warning_categories = Array.from(warningCategoryMap.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const top_warnings = Array.from(warningMap.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const top_error_categories = Array.from(errorCategoryMap.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const top_errors = Array.from(errorMap.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  let failure_diagnostics: FailureDiagnostics | null = null;
  if (top_error_categories.length) {
    const topCategory = String(top_error_categories[0]?.category || "");
    const sampleError = top_errors.length ? String(top_errors[0]?.reason || "") : null;
    const diagMap: Record<string, { issue: string; next_step: string; action: string }> = {
      db: {
        issue: "database failures dominate",
        next_step: "inspect Supabase connectivity, schema cache, and route auth before rerunning recipes",
        action: "inspect_db_connectivity",
      },
      render: {
        issue: "render path is failing most often",
        next_step: "check output_url/render provider path and retry the failing render stage first",
        action: "inspect_render_path",
      },
      generation: {
        issue: "generation nodes are failing before render",
        next_step: "inspect failing generation tools and provider responses before retrying full runs",
        action: "inspect_generation_path",
      },
      timeout: {
        issue: "timeouts dominate the current sample",
        next_step: "inspect the slowest steps and raise timeout or reduce fan-out before rerunning",
        action: "inspect_timeout_path",
      },
      quality: {
        issue: "quality gates are rejecting or failing most often",
        next_step: "inspect critic/artifact/OTK failures and confirm fail-open vs fail-closed behavior",
        action: "inspect_quality_gate_path",
      },
      storage: {
        issue: "storage/save path is unstable",
        next_step: "inspect catalog/gen-save/output persistence before retrying downstream stages",
        action: "inspect_storage_path",
      },
      budget: {
        issue: "budget guardrails are stopping runs",
        next_step: "inspect launch caps and provider balance before restarting queues",
        action: "inspect_budget_guardrails",
      },
      input: {
        issue: "input validation is breaking runs early",
        next_step: "inspect recipe_id payload and required input artifacts before rerunning",
        action: "inspect_input_path",
      },
      other: {
        issue: "uncategorized failures dominate the sample",
        next_step: "inspect top error strings and the last failed runs before widening retries",
        action: "inspect_failed_runs",
      },
    };
    const picked = diagMap[topCategory] || diagMap.other;
    failure_diagnostics = {
      issue: picked.issue,
      category: topCategory || null,
      sample_error: sampleError,
      next_step: picked.next_step,
      action: picked.action,
    };
  }

  const status_series = Array.from(statusSeriesMap.values())
    .sort((a, b) => a.bucket.localeCompare(b.bucket))
    .slice(-12);

  const slowSteps = slowest_steps.map((s) => s.step).filter(Boolean);
  const step_duration_series = Array.from(stepSeriesMap.values())
    .filter((row) => slowSteps.includes(row.step))
    .map((row) => ({
      bucket: row.bucket,
      step: row.step,
      avg_ms: row.samples ? Math.round(row.total_ms / row.samples) : null,
      samples: row.samples,
    }))
    .sort((a, b) => a.bucket === b.bucket ? slowSteps.indexOf(a.step) - slowSteps.indexOf(b.step) : a.bucket.localeCompare(b.bucket))
    .slice(-24);

  const windowSize = 10;
  const stabilitySample = stabilityWindow.slice(0, windowSize);
  let successStreak = 0;
  for (const run of stabilitySample) {
    if (!run.success) break;
    successStreak += 1;
  }
  const stability_snapshot: StabilitySnapshot = {
    window_size: windowSize,
    sample_size: stabilitySample.length,
    successful_runs: stabilitySample.filter((r) => r.success).length,
    warning_runs: stabilitySample.filter((r) => r.status === "warning").length,
    failed_runs: stabilitySample.filter((r) => r.status === "run_fail").length,
    running_runs: stabilitySample.filter((r) => r.status === "running").length,
    success_streak: successStreak,
    target_successes: windowSize,
    target_met: stabilitySample.length >= windowSize && successStreak >= windowSize,
  };
  const qualitySample = qualityBasisWindow.slice(0, windowSize);
  const modelRuns = qualitySample.filter((v) => v.basis === "model").length;
  const textRuns = qualitySample.filter((v) => v.basis === "text").length;
  const fallbackRuns = qualitySample.filter((v) => v.basis === "fallback").length;
  const missingBasis = 0;
  const qualityReasonMap = new Map<string, number>();
  qualitySample.forEach((v) => {
    if (!v.reason) return;
    qualityReasonMap.set(v.reason, (qualityReasonMap.get(v.reason) || 0) + 1);
  });
  const basisPairs = [
    ["model", modelRuns],
    ["text", textRuns],
    ["fallback", fallbackRuns],
    ["missing", missingBasis],
  ].sort((a, b) => Number(b[1]) - Number(a[1]));
  const quality_signal: QualitySignalSnapshot = {
    sample_size: qualitySample.length,
    model_runs: modelRuns,
    text_runs: textRuns,
    fallback_runs: fallbackRuns,
    missing_basis: missingBasis,
    dominant_basis: basisPairs[0] && Number(basisPairs[0][1]) > 0 ? String(basisPairs[0][0]) : null,
    fallback_ratio: qualitySample.length ? Math.round((fallbackRuns / qualitySample.length) * 100) / 100 : 0,
    top_basis_reason: Array.from(qualityReasonMap.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
  };

  return {
    sample_runs: rows.length,
    running,
    warning_runs: warningRuns,
    failed,
    stability_snapshot,
    quality_signal,
    recent_runs: recentRuns.slice(0, 12),
    incident_runs: incidentRuns.slice(0, 8),
    status_series,
    step_duration_series,
    slowest_steps,
    failure_diagnostics,
    top_error_categories,
    top_errors,
    top_warning_categories,
    top_warnings,
  };
}

export function buildStabilityReport(rows: Record<string, unknown>[]): StabilityReport {
  const observability = buildObservability(rows) as {
    stability_snapshot?: StabilitySnapshot;
    incident_runs?: IncidentRunPoint[];
    recent_runs?: RecentRunPoint[];
    failure_diagnostics?: FailureDiagnostics | null;
  };
  const snapshot = observability.stability_snapshot || {
    window_size: 10,
    sample_size: 0,
    successful_runs: 0,
    warning_runs: 0,
    failed_runs: 0,
    running_runs: 0,
    success_streak: 0,
    target_successes: 10,
    target_met: false,
  };
  return {
    ...snapshot,
    generated_at: new Date().toISOString(),
    incident_runs: Array.isArray(observability.incident_runs) ? observability.incident_runs.slice(0, 8) : [],
    recent_runs: Array.isArray(observability.recent_runs) ? observability.recent_runs.slice(0, 10) : [],
    failure_diagnostics: observability.failure_diagnostics || null,
  };
}
