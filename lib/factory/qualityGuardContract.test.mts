import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const graphRun = readFileSync("lib/factory/graphRun.ts", "utf8");

ok(/const FIRST_FRAME_HOOK_MAX = 86;/.test(graphRun), "first-frame hook has a bounded display length");
ok(/function compactHookText\(value: unknown\): string/.test(graphRun), "graph-run normalizes hook text before render props");
ok(/first_frame_hook_required: true/.test(graphRun), "submit guard marks first-frame hook as required");
ok(/\.\.\.\(hookText \? \[\{ text: hookText, accent: true \}\] : \[\]\)/.test(graphRun), "ReelV5 props put hook as the first caption");
ok(/Product identity lock: keep the exact same item/.test(graphRun), "submit guard locks product identity across generated scenes");
ok(/product_identity_drift/.test(graphRun), "OTK can structurally regen inconsistent product scenes");

ok(/function isAudienceMode\(mode\?: string \| null\): boolean/.test(graphRun), "graph-run distinguishes audience mode");
ok(/const ctaButton = isAudienceMode\(mode\) \? "сохрани идею" : "ищи на WB";/.test(graphRun), "audience renders native save CTA instead of WB buy CTA");
ok(/Audience mode: no direct WB buy button/.test(graphRun), "submit guard forbids ad-card CTA prompts in audience mode");
ok(/cta_text: nativeCta/.test(graphRun), "audience CTA is visible to the storyboard critic");

ok(/function structuralOtkProblem\(issues: string\[\], mode: string\): string \| null/.test(graphRun), "OTK issues are classified for structural regen");
ok(/function regenStructuralOtk/.test(graphRun), "graph-run can reset multiple nodes for structural OTK failures");
ok(/otk structural regen:/.test(graphRun), "OTK uses structural regen before single-node culprit regen");
ok(/comparison hook guarded: forcing side-by-side visual proof/.test(graphRun), "comparison hooks force visible comparison proof");

ok(/const MAX_RENDER_POLL_MS = 180_000;/.test(graphRun), "render-poll has a wall-clock timeout");
ok(/const timedOutByWallClock = stepAgeMs\(plan, "render-poll"\) >= MAX_RENDER_POLL_MS;/.test(graphRun), "render-poll checks wall-clock age");
ok(/render timeout`\s\+ \(timedOutByWallClock \? " \(wall-clock\)" : ""\)/.test(graphRun), "render timeout message identifies wall-clock stalls");

ok(/n\.status = "skip";[\s\S]*creatify skipped: persona consent missing/.test(graphRun), "Creatify without persona consent is skipped for MVP instead of failing the visual graph");

console.log("qualityGuardContract: passed");
