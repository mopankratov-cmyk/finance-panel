import { buildRunSummary } from "./observability";

let passed = 0;
let failed = 0;

function ok(cond: boolean, msg: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", msg);
  }
}

const summary = buildRunSummary({
  run_id: "run_new",
  execution_log: [
    {
      run_id: "run_old",
      step: "render-poll",
      status: "running",
      started_at: "2026-06-27T00:00:00.000Z",
      finished_at: null,
    },
    {
      run_id: "run_new",
      step: "render-submit",
      status: "done",
      started_at: "2026-06-27T01:00:00.000Z",
      finished_at: "2026-06-27T01:00:01.000Z",
    },
    {
      run_id: "run_new",
      step: "render-poll",
      status: "running",
      started_at: "2026-06-27T01:00:02.000Z",
      finished_at: "2026-06-27T01:00:05.000Z",
    },
    {
      run_id: "run_new",
      step: "bank",
      status: "warning",
      started_at: "2026-06-27T01:00:06.000Z",
      finished_at: "2026-06-27T01:00:09.000Z",
    },
  ],
});

ok(summary.active_step === null, "run summary does not keep stale active_step after the last step finished");
ok(summary.last_step === "bank", "run summary keeps the terminal step from the current run");
ok(summary.steps_total === 3, "run summary ignores old run entries when current run_id is known");

if (failed) process.exit(1);
console.log(`runSummaryActiveStep: ${passed} passed, ${failed} failed`);
