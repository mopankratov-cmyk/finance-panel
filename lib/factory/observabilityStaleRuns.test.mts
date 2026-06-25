import { buildObservability } from "./observability";

let passed = 0;
let failed = 0;

function ok(cond: boolean, msg: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", msg);
  }
}

const now = Date.now();
const staleStarted = new Date(now - 31 * 60 * 1000).toISOString();
const freshStarted = new Date(now - 5 * 60 * 1000).toISOString();

const out = buildObservability([
  {
    id: 101,
    status: "running",
    created_at: staleStarted,
    run_plan: {
      run_id: "run_stale",
      execution_log: [
        {
          step: "render-poll",
          status: "running",
          started_at: staleStarted,
          finished_at: null,
        },
      ],
      warnings: [],
    },
  },
  {
    id: 102,
    status: "running",
    created_at: freshStarted,
    run_plan: {
      run_id: "run_fresh",
      execution_log: [
        {
          step: "render-poll",
          status: "running",
          started_at: freshStarted,
          finished_at: null,
        },
      ],
      warnings: [],
    },
  },
  {
    id: 103,
    status: "warning",
    created_at: new Date(now - 60 * 1000).toISOString(),
    run_plan: {
      run_id: "run_warn",
      execution_log: [
        {
          step: "bank",
          status: "warning",
          started_at: new Date(now - 90 * 1000).toISOString(),
          finished_at: new Date(now - 60 * 1000).toISOString(),
        },
      ],
      warnings: ["OTK below threshold: 6"],
    },
  },
]);

ok(Number((out as { stale_running?: unknown }).stale_running || 0) === 1, "observability counts stale running runs separately");
ok(Array.isArray(out.recent_runs) && out.recent_runs[0]?.stale === true, "recent_runs marks stale running entries");
ok(Array.isArray(out.incident_runs) && out.incident_runs.some((r) => r.status === "stale_running" && r.error_category === "timeout"), "stale running run becomes incident with timeout category");

if (failed) process.exit(1);
console.log(`observabilityStaleRuns: ${passed} passed, ${failed} failed`);
