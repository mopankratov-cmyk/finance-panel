import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const approve = readFileSync("app/api/factory/approve/route.ts", "utf8");
const studio = readFileSync("public/inferno/studio.html", "utf8");
const improvement = readFileSync("lib/factory/improvementLoop.ts", "utf8");

ok(/event: "approved"/.test(approve), "approve route records explicit approved feedback");
ok(/feedback_type: "quality"/.test(approve), "approve route marks feedback as internal quality signal");
ok(!/is_winner: true/.test(approve), "approve route does not mark assets as market winners");
ok(!/\.from\("viral_hooks"\)/.test(approve), "approve route does not seed winner hooks");
ok(/api\("\/approve"/.test(studio), "Studio learning queue can submit quality feedback");
ok(/quality ok записан/.test(studio), "Studio confirms quality feedback separately from winners");
ok(/api\("\/winners"/.test(studio), "Studio keeps explicit winner action separate");
ok(/api\("\/post-metrics"/.test(studio), "Studio keeps real market metrics action separate");
ok(/row\.feedback_status !== "none" \|\| \(row\.market_views \|\| 0\) > 0/.test(improvement), "learning gate counts explicit approved/rejected feedback");

console.log("learningFeedbackContract: passed");
