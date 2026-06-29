import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const watchdog = readFileSync("lib/factory/graphWatchdog.ts", "utf8");

ok(/const RENDER_POLL_FORCE_RELEASE_MS = 240_000;/.test(watchdog), "watchdog has a hard render-poll lease release threshold");
ok(/const GEN_POLL_FORCE_RELEASE_MS = 540_000;/.test(watchdog), "watchdog has a hard gen-poll lease release threshold");
ok(/function pollStepOverdue/.test(watchdog), "watchdog detects over-aged polling steps");
ok(/plan\.step !== "render-poll" && plan\.step !== "gen-poll"/.test(watchdog), "force release is limited to provider polling steps");
ok(/plan\.step === "render-poll" \? RENDER_POLL_FORCE_RELEASE_MS : GEN_POLL_FORCE_RELEASE_MS/.test(watchdog), "watchdog applies per-step polling thresholds");
ok(/p\.lease_until = null;/.test(watchdog), "watchdog clears stuck polling lease");
ok(/update\(\{ run_plan: p, updated_at: new Date\(\)\.toISOString\(\) \}\)\.eq\("id", row\.id\)/.test(watchdog), "watchdog persists released polling lease");
ok(/pollStepOverdue\(p\)/.test(watchdog), "wake path applies polling overdue check before stuck filtering");

console.log("renderPollWatchdogContract: passed");
