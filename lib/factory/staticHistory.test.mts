import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string) { if (cond) pass += 1; else { fail += 1; console.error("FAIL", msg); } }

const generate = readFileSync("app/api/factory/static-generate/route.ts", "utf8");
const status = readFileSync("app/api/factory/static-status/route.ts", "utf8");
const studio = readFileSync("public/inferno/studio.html", "utf8");

ok(/import \{ logGeneration \} from "@\/lib\/factory\/genHistory"/.test(generate), "static-generate imports history logger");
ok(/source: "static_generate"[\s\S]*reason: "static_render_submitted"/.test(generate), "static-generate logs submitted jobs");
ok(/params: \{ task_id: id, format, archetype/.test(generate), "static-generate stores task metadata in history params");
ok(/import \{ logGeneration \} from "@\/lib\/factory\/genHistory"/.test(status), "static-status imports history logger");
ok(/s\.status === "done" && s\.videoUrl[\s\S]*source: "static_status"[\s\S]*reason: "static_render_done"/.test(status), "static-status logs completed static renders with output URL");
ok(/s\.status === "error" && s\.retryable === false[\s\S]*status: "artifact_fail"/.test(status), "static-status logs terminal render failures");
ok(/new URLSearchParams\(\{id:String\(job\.id\),format:String\(job\.format\|\|""\),article:String\(job\.article\|\|""\),headline:String\(job\.headline\|\|""\),niche:String\(job\.niche\|\|""\)\}\)/.test(studio), "Studio passes static lineage metadata into status polling");

console.log(`staticHistory: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
