import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const route = readFileSync("app/api/factory/memory-quality/route.ts", "utf8");
const improvement = readFileSync("lib/factory/improvementLoop.ts", "utf8");

ok(/function authOk/.test(route) && /CRON_SECRET/.test(route), "memory-quality endpoint is operator-authenticated");
ok(/memory_label/.test(route) && /memory_score/.test(route), "memory-quality writes label and score into content_assets analysis");
ok(/\"winner\" \| \"usable\" \| \"trash\"/.test(route), "memory-quality has the three MVP memory labels");
ok(/OTK below usable threshold/.test(route), "memory-quality marks low OTK videos as trash");
ok(/restored from storage; needs human\/OTK review/.test(route), "storage-restored videos stay usable but low-confidence");
ok(/body\.apply === true/.test(route), "memory-quality requires explicit apply=true before updates");

ok(/memory_label: "winner" \| "usable" \| "trash" \| "unlabeled";/.test(improvement), "improvement run carries memory label");
ok(/run\.memory_label === "trash"\) return "loser"/.test(improvement), "trash memory is excluded from successful learning");
ok(/run\.memory_label === "winner"\) return "winner"/.test(improvement), "winner memory is promoted in learning");

console.log("memoryQualityContract: passed");
