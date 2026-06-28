import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const source = readFileSync("app/api/factory/telegram/send-review/route.ts", "utf8");

ok(/tgSendReview/.test(source), "send-review route uses factory telegram review adapter");
ok(/process\.env\.CRON_SECRET/.test(source), "send-review route is protected by CRON_SECRET");
ok(/authorization"\) === `Bearer \$\{secret\}`/.test(source), "send-review route checks bearer token");
ok(/videos\.slice\(0, 10\)/.test(source), "send-review route caps batch size");
ok(/recipe_id\/url/.test(source), "send-review route validates recipe id and URL");

console.log("telegramSendReviewRouteContract: passed");
