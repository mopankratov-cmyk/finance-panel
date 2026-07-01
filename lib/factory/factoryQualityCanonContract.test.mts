import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const generic = readFileSync("lib/factory/genericOpeners.ts", "utf8");
const candidate = readFileSync("lib/factory/candidateSelect.ts", "utf8");
const hookPolicy = readFileSync("lib/factory/hookPolicy.ts", "utf8");
const scenario = readFileSync("lib/factory/scenarioQuality.ts", "utf8");
const artifactRoute = readFileSync("app/api/factory/artifact-check/route.ts", "utf8");

ok(/GENERIC_OPENER_PATTERNS/.test(generic) && /рекомендую/.test(generic), "generic opener canon includes recommendation/ad openings");
ok(candidate.includes('from "./genericOpeners"'), "candidate select imports shared generic opener canon");
ok(hookPolicy.includes('from "./genericOpeners"'), "hook policy imports shared generic opener canon");
ok(scenario.includes('from "./genericOpeners"'), "scenario quality imports shared generic opener canon");
ok(/import \{ runArtifactCheck \}/.test(artifactRoute), "artifact-check route delegates to qaGates runArtifactCheck");

console.log("factoryQualityCanonContract: passed");
