// Юнит-тест файлового архива stress reports. Запуск: node --import tsx lib/factory/stabilityArtifacts.test.mts
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) { pass++; } else { fail++; console.error("x", m); } }
function eq(a: unknown, b: unknown, m: string) { ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)})`); }

const originalCwd = process.cwd();
const tmp = await mkdtemp(path.join(os.tmpdir(), "factory-stress-history-"));

try {
  process.chdir(tmp);
  await mkdir(path.join(tmp, "docs", "factory-stress-history"), { recursive: true });
  await writeFile(path.join(tmp, "docs", "factory-latest-stress.json"), JSON.stringify({
    generatedAt: "2026-06-25T10:00:00.000Z",
    summary: { recipeId: 68, totalRuns: 10, completed: 10, failed: 0, warnings: 2, runFail: 0, timeouts: 0, avgDurationSec: 31 },
  }));
  await writeFile(path.join(tmp, "docs", "factory-stress-history", "2026-06-25T10-00-00-000Z.json"), JSON.stringify({
    generatedAt: "2026-06-25T10:00:00.000Z",
    summary: { recipeId: 68, totalRuns: 10, completed: 10, failed: 0, warnings: 2, runFail: 0, timeouts: 0, avgDurationSec: 30 },
    stability: { ok: true, stability: { target_met: true } },
  }));
  await writeFile(path.join(tmp, "docs", "factory-stress-history", "2026-06-25T11-00-00-000Z.json"), JSON.stringify({
    generatedAt: "2026-06-25T11:00:00.000Z",
    summary: { recipeId: 69, totalRuns: 10, completed: 8, failed: 1, warnings: 4, runFail: 1, timeouts: 0, avgDurationSec: 60 },
    stability: { ok: true, stability: { target_met: false } },
  }));
  await writeFile(path.join(tmp, "docs", "factory-stress-history", "2026-06-25T12-00-00-000Z.json"), "{bad json");
  await writeFile(path.join(tmp, "docs", "factory-stress-history", "note.md"), "ignore");

  const mod = await import(`./stabilityArtifacts.ts?case=${Date.now()}`);
  const latest = await mod.readLatestStressArtifact();
  eq(latest?.summary?.completed, 10, "latest artifact прочитан");

  const summary = await mod.readStressHistorySummary();
  eq(summary.total_reports, 2, "битый JSON и markdown проигнорированы");
  eq(summary.total_runs, 20, "total_runs агрегирован");
  eq(summary.completed_runs, 18, "completed агрегирован");
  eq(summary.failed_runs, 1, "failed агрегирован");
  eq(summary.warning_runs, 6, "warnings агрегированы");
  eq(summary.run_failures, 1, "run_fail агрегирован");
  eq(summary.target_met_reports, 1, "target_met_reports агрегирован");
  eq(summary.avg_duration_sec, 45, "avg duration считается по report averages");
  eq(summary.latest_generated_at, "2026-06-25T11:00:00.000Z", "latest берётся из самого нового файла");
  eq(summary.recent_reports.map((r: { recipe_id: number | null }) => r.recipe_id), [69, 68], "recent_reports отсортированы newest-first");

  const limited = await mod.readStressHistorySummary(1);
  eq(limited.total_reports, 1, "limit ограничивает число отчётов");
  eq(limited.completed_runs, 8, "limit агрегирует только выбранное окно");
} finally {
  process.chdir(originalCwd);
  await rm(tmp, { recursive: true, force: true });
}

console.log(`\nstabilityArtifacts: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
