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

check(/function isWorkerInfraAlertCode\(code: string \| null\)/.test(source), "ops route defines worker infra alert partition helper");
check(/function isWorkerInfraAction\(action: string \| null\)/.test(source), "ops route defines worker infra action partition helper");
check(/const worker_infra_alerts = alerts\.filter\(\(alert\) => isWorkerInfraAlertCode\(alert\.code \|\| null\)\);/.test(source), "ops route exposes worker_infra_alerts");
check(/const factory_alerts = alerts\.filter\(\(alert\) => !isWorkerInfraAlertCode\(alert\.code \|\| null\)\);/.test(source), "ops route exposes factory_alerts");
check(/const worker_infra_actions = suggested_actions\.filter\(\(action\) => isWorkerInfraAction\(action\.action \|\| null\)\);/.test(source), "ops route exposes worker_infra_actions");
check(/const factory_actions = suggested_actions\.filter\(\(action\) => !isWorkerInfraAction\(action\.action \|\| null\)\);/.test(source), "ops route exposes factory_actions");

console.log(`opsAlertPartition: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
