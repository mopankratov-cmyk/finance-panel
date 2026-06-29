import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const studio = readFileSync("public/inferno/studio.html", "utf8");

ok(/function m6StatusSummary\(m6\)/.test(studio), "Studio defines compact M6 status summary");
ok(/function m6Chip\(label,tone,title\)/.test(studio), "Studio defines reusable M6 status chips");
ok(/m6StatusSummary\(S\.workerState&&S\.workerState\.m6\)/.test(studio), "Factory pulse reads M6 ops payload");
ok(/m6StatusSummary\(d\.m6\)/.test(studio), "Worker screen reads M6 ops payload");
ok(/m6Status/.test(studio) && /renderCenterOpsSummary/.test(studio), "Command center receives M6 status");
ok(/M6: публикации · UGC/.test(studio), "Worker screen surfaces publication and UGC ledger");
ok(/pub "\+m6Status\.pubPublished\+"\//.test(studio), "Studio shows publication totals");
ok(/ugc "\+m6Status\.ugcDone\+"\//.test(studio), "Studio shows UGC job totals");
ok(/dlq/.test(studio), "Studio surfaces UGC DLQ signal");

console.log("m6StatusUiContract: passed");
