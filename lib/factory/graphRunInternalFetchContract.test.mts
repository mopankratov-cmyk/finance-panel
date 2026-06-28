import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const source = readFileSync("lib/factory/graphRun.ts", "utf8");

ok(/const bodyError = String\(j\?\.error \|\| j\?\.detail \|\| j\?\.warning \|\| ""\)\.trim\(\);/.test(source), "jpost extracts body-level internal API errors");
ok(/async function jpost\(origin: string, path: string, body: unknown, ms = 90000, failOnBodyFalse = false\): Promise<any>/.test(source), "jpost supports opt-in body failure handling");
ok(/if \(!r\.ok \|\| \(failOnBodyFalse && j\?\.ok === false\)\)/.test(source), "jpost treats ok:false payloads as failures only when the caller opts in");
ok(/const code = r\.ok \? "body_fail" : String\(r\.status\);/.test(source), "jpost distinguishes HTTP failures from body-declared failures");
ok(/\/api\/factory\/gen-save"[\s\S]*40000, true\)/.test(source), "graph-run opts into body-level failure handling for gen-save");

console.log("graphRunInternalFetchContract: passed");
