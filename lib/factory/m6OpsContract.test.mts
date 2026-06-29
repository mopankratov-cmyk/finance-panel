import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const helper = readFileSync("lib/factory/m6Ops.ts", "utf8");
const opsRoute = readFileSync("app/api/factory/ops/route.ts", "utf8");

ok(/export async function loadM6OpsSnapshot/.test(helper), "M6 ops snapshot helper exists");
ok(/factory_publications/.test(helper), "M6 ops reads factory_publications");
ok(/factory_ugc_jobs/.test(helper), "M6 ops reads factory_ugc_jobs");
ok(/by_status/.test(helper) && /by_dlq_category/.test(helper), "M6 ops summarizes statuses and DLQ categories");
ok(/safeSelect/.test(helper) && /warning/.test(helper), "M6 ops is fail-open");

ok(/import \{ loadM6OpsSnapshot \} from "@\/lib\/factory\/m6Ops"/.test(opsRoute), "ops route imports M6 snapshot");
ok(/loadM6OpsSnapshot\(db\)/.test(opsRoute), "ops route loads M6 snapshot");
ok(/m6,/.test(opsRoute), "ops route returns m6 payload");
ok(/m6: null/.test(opsRoute), "ops route has m6 fallback contracts");

console.log("m6OpsContract: passed");
