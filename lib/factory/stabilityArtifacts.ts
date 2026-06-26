import { promises as fs } from "node:fs";
import path from "node:path";

const LATEST_STRESS_JSON = path.join(process.cwd(), "docs", "factory-latest-stress.json");
const STRESS_HISTORY_DIR = path.join(process.cwd(), "docs", "factory-stress-history");

export type LatestStressArtifact = {
  generatedAt?: string;
  summary?: {
    recipeId?: number;
    totalRuns?: number;
    completed?: number;
    failed?: number;
    warnings?: number;
    runFail?: number;
    authFailures?: number;
    timeouts?: number;
    avgDurationSec?: number;
    targetMet?: boolean;
  };
  stability?: {
    ok?: boolean;
    stability?: {
      success_streak?: number;
      successful_runs?: number;
      window_size?: number;
      target_met?: boolean;
      failure_diagnostics?: {
        issue?: string;
      } | null;
    } | null;
    error?: string;
  } | null;
  results?: unknown[];
};

export type StressHistorySummary = {
  total_reports: number;
  total_runs: number;
  completed_runs: number;
  failed_runs: number;
  warning_runs: number;
  run_failures: number;
  timeouts: number;
  target_met_reports: number;
  avg_duration_sec: number | null;
  latest_generated_at: string | null;
  recent_reports: {
    generated_at: string | null;
    recipe_id: number | null;
    total_runs: number;
    completed: number;
    failed: number;
    warnings: number;
    run_fail: number;
    timeouts: number;
    target_met: boolean | null;
  }[];
};

export async function readLatestStressArtifact(): Promise<LatestStressArtifact | null> {
  try {
    const raw = await fs.readFile(LATEST_STRESS_JSON, "utf8");
    const parsed = JSON.parse(raw) as LatestStressArtifact;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function stressReportPoint(payload: LatestStressArtifact): StressHistorySummary["recent_reports"][number] {
  const summary = payload.summary || {};
  const totalRuns = Number(summary.totalRuns || 0);
  const completed = Number(summary.completed || 0);
  const failed = Number(summary.failed || 0);
  const runFail = Number(summary.runFail || 0);
  const authFailures = Number(summary.authFailures || 0);
  const timeouts = Number(summary.timeouts || 0);
  const targetMet =
    typeof summary.targetMet === "boolean"
      ? summary.targetMet
      : totalRuns > 0 && completed === totalRuns && failed === 0 && runFail === 0 && authFailures === 0 && timeouts === 0;
  return {
    generated_at: payload.generatedAt || null,
    recipe_id: typeof summary.recipeId === "number" ? summary.recipeId : null,
    total_runs: totalRuns,
    completed,
    failed,
    warnings: Number(summary.warnings || 0),
    run_fail: runFail,
    timeouts,
    target_met: targetMet,
  };
}

export async function readStressHistorySummary(limit = 20): Promise<StressHistorySummary> {
  const empty: StressHistorySummary = {
    total_reports: 0,
    total_runs: 0,
    completed_runs: 0,
    failed_runs: 0,
    warning_runs: 0,
    run_failures: 0,
    timeouts: 0,
    target_met_reports: 0,
    avg_duration_sec: null,
    latest_generated_at: null,
    recent_reports: [],
  };
  try {
    const maxReports = Math.max(1, Math.min(100, limit));
    const files = (await fs.readdir(STRESS_HISTORY_DIR))
      .filter((name) => name.endsWith(".json"))
      .sort()
      .reverse();
    if (!files.length) return empty;
    const reports: LatestStressArtifact[] = [];
    for (const file of files) {
      try {
        const raw = await fs.readFile(path.join(STRESS_HISTORY_DIR, file), "utf8");
        const parsed = JSON.parse(raw) as LatestStressArtifact;
        if (parsed && typeof parsed === "object") reports.push(parsed);
        if (reports.length >= maxReports) break;
      } catch {
        // Ignore a partial or manually edited archive file; latest/history must stay best-effort.
      }
    }
    if (!reports.length) return empty;
    const recent = reports.map(stressReportPoint);
    const durationSamples = reports
      .map((r) => Number(r.summary?.avgDurationSec || 0))
      .filter((n) => Number.isFinite(n) && n > 0);
    return {
      total_reports: reports.length,
      total_runs: recent.reduce((acc, r) => acc + r.total_runs, 0),
      completed_runs: recent.reduce((acc, r) => acc + r.completed, 0),
      failed_runs: recent.reduce((acc, r) => acc + r.failed, 0),
      warning_runs: recent.reduce((acc, r) => acc + r.warnings, 0),
      run_failures: recent.reduce((acc, r) => acc + r.run_fail, 0),
      timeouts: recent.reduce((acc, r) => acc + r.timeouts, 0),
      target_met_reports: recent.filter((r) => r.target_met === true).length,
      avg_duration_sec: durationSamples.length ? Math.round(durationSamples.reduce((acc, n) => acc + n, 0) / durationSamples.length) : null,
      latest_generated_at: recent[0]?.generated_at || null,
      recent_reports: recent,
    };
  } catch {
    return empty;
  }
}
