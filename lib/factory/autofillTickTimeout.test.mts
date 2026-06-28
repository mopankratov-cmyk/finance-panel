import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const source = readFileSync("lib/factory/graphRun.ts", "utf8");
const watchdog = readFileSync("lib/factory/graphWatchdog.ts", "utf8");
const cron = readFileSync("app/api/factory/graph-run/cron/route.ts", "utf8");

ok(!/\/api\/factory\/autofill/.test(source), "graph-run runtime does not wait on expensive autofill route");
ok(/runtime autofill skipped fail-open; using prepared draft nodes/.test(source), "autofill step is explicit fail-open warning");
ok(/plan\.step = "submit";/.test(source), "autofill step checkpoints directly to submit");
ok(/finishExecutionLog\(plan, trace, needsFill \? "warning" : "done", "submit"/.test(source), "autofill checkpoint is traced as warning when draft fill is incomplete");

const checkpointIndex = source.indexOf('autofill checkpoint→submit');
const saveIndex = source.indexOf('await savePlan(db, id, plan, { status: "running" });', checkpointIndex);
ok(checkpointIndex > 0 && saveIndex > checkpointIndex, "autofill checkpoint is persisted in the same step");
ok(/const DEFAULT_MAX_WAKE = 10;/.test(watchdog), "watchdog can wake a full five-recipe batch plus stale noise");
ok(/\.contains\("run_plan", \{ step: "autofill" \}\)/.test(watchdog), "watchdog explicitly includes stuck autofill recipes");
ok(/const \{ data: recentData \}/.test(watchdog), "watchdog also includes recent running recipes, not only oldest stale rows");
ok(/submit_started_at/.test(source), "submit step tracks one logical submit pass across multiple ticks");
ok(/submittedThisTick\+\+/.test(source), "submit step counts real engine submissions per tick");
ok(/submit partial→submit/.test(source), "submit step can yield after a partial node submit");
ok(/m\.status === "done" \|\| m\.status === "submitted" \|\| m\.status === "skip" \|\| m\.status === "error"/.test(source), "submit loop treats errored nodes as terminal for the current pass");
ok(/n\.status === "done" \|\| n\.status === "submitted" \|\| n\.status === "error"/.test(source), "submit loop does not re-submit nodes that already failed");
ok(/const shouldYieldSubmitPass = n\.status === "submitted" && plan\.nodes\.some\(needsSubmit\);/.test(source), "submit loop yields only after a real async submission, not after every terminal error");
ok(/function isProviderBalanceStop\(error: string \| null \| undefined\): boolean/.test(source), "submit loop classifies provider balance locks explicitly");
ok(/collapsePendingProviderNodes\(plan, r\.engine, r\.error\)/.test(source), "provider-wide balance stop collapses sibling nodes in the same submit family");
ok(/const CRON_MAX_WAKE = 5;/.test(cron), "cron caps wake burst to one batch-sized backstop pass");
ok(/maxWake: CRON_MAX_WAKE/.test(cron), "cron reuses the shared wake cap constant");

console.log("autofillTickTimeout: passed");
