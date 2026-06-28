import { readFileSync } from "fs";
import { ok } from "assert";

const source = readFileSync("app/api/factory/ops/route.ts", "utf8");

let passed = 0;
let failed = 0;

function check(condition: unknown, message: string) {
  try {
    ok(condition, message);
    passed++;
  } catch (error) {
    failed++;
    console.error(message);
    if (error instanceof Error) console.error(error.message);
  }
}

check(/function isWorkerInfraIssue\(issue: string \| null\)/.test(source), "ops route exposes worker infra issue helper");
check(/input\.workerSource === "queue_fallback" && !isWorkerInfraIssue\(input\.workerIssue\)/.test(source), "ops status ignores pure worker infra fallback noise");
check(!/if \(input\.workerSource === "queue_fallback"\) \{\s+if \(input\.workerIssue === "table_missing"\)/.test(source), "ops status no longer escalates factory health from worker table missing branch");

console.log(`opsWorkerInfraStatus: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
