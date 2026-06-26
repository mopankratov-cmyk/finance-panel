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
const recentFailAt = new Date(now - 30 * 60 * 1000).toISOString();
const recentWarningAt = new Date(now - 10 * 60 * 1000).toISOString();
const legacyFailAt = new Date(now - 30 * 60 * 60 * 1000).toISOString();
const legacyWarningAt = new Date(now - 48 * 60 * 60 * 1000).toISOString();

const out = buildObservability([
  {
    id: 201,
    status: "run_fail",
    created_at: legacyFailAt,
    run_plan: {
      run_id: "run_legacy_fail",
      error: "database timeout in legacy sample",
      execution_log: [
        {
          step: "render-poll",
          status: "error",
          started_at: legacyFailAt,
          finished_at: legacyFailAt,
        },
      ],
      warnings: [],
    },
  },
  {
    id: 202,
    status: "run_fail",
    created_at: recentFailAt,
    run_plan: {
      run_id: "run_recent_fail",
      error: "render provider timeout",
      execution_log: [
        {
          step: "render-poll",
          status: "error",
          started_at: recentFailAt,
          finished_at: recentFailAt,
        },
      ],
      warnings: [],
    },
  },
  {
    id: 203,
    status: "warning",
    created_at: legacyWarningAt,
    run_plan: {
      run_id: "run_legacy_warning",
      warnings: ["OTK below threshold: 6"],
      execution_log: [
        {
          step: "bank",
          status: "warning",
          started_at: legacyWarningAt,
          finished_at: legacyWarningAt,
        },
      ],
    },
  },
  {
    id: 204,
    status: "warning",
    created_at: recentWarningAt,
    run_plan: {
      run_id: "run_recent_warning",
      warnings: ["video-critic timeout"],
      execution_log: [
        {
          step: "bank",
          status: "warning",
          started_at: recentWarningAt,
          finished_at: recentWarningAt,
        },
      ],
    },
  },
]);

ok(Number((out as { failed?: unknown }).failed || 0) === 1, "only active failed runs count toward live failed metric");
ok(Number((out as { legacy_failed_runs?: unknown }).legacy_failed_runs || 0) === 1, "legacy failed runs are tracked separately");
ok(Number((out as { warning_runs?: unknown }).warning_runs || 0) === 1, "only active warnings count toward live warning metric");
ok(Number((out as { legacy_warning_runs?: unknown }).legacy_warning_runs || 0) === 1, "legacy warnings are tracked separately");
ok(Number((out as { active_sample_runs?: unknown }).active_sample_runs || 0) === 2, "active sample only includes runs inside the live incident window");
ok(Array.isArray(out.incident_runs) && out.incident_runs.length === 2, "incident list contains only active incidents");
ok(Array.isArray(out.incident_runs) && !out.incident_runs.some((r) => r.recipe_id === 201 || r.recipe_id === 203), "legacy incidents stay out of live incident list");
ok(Array.isArray(out.recent_runs) && out.recent_runs.some((r) => r.recipe_id === 201 && r.legacy === true), "recent_runs marks legacy failed entries explicitly");

if (failed) process.exit(1);
console.log(`observabilityLegacyIncidents: ${passed} passed, ${failed} failed`);
