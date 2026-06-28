import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const html = readFileSync("public/inferno/studio.html", "utf8");

ok(/function warningCategoryMeta\(cat\)/.test(html), "studio defines warning category presentation metadata");
ok(/function warningReasonHint\(reason\)/.test(html), "studio defines warning reason hints for operators");
ok(/"warning groups"/.test(html), "observability card renders warning groups section");
ok(/"repeating warning reasons"/.test(html), "observability card renders repeating warning reasons section");
ok(/const sum=cats\.slice\(0,4\)\.reduce\(\(a,w\)=>a\+Number\(w\.count\|\|0\),0\)\|\|1;/.test(html), "warning groups compute share from top categories");
ok(/warns\.slice\(0,3\)\.forEach\(\(w\)=>\{/.test(html), "top warning reasons render in a dedicated digest");

console.log("studioWarningDigestContract: passed");
