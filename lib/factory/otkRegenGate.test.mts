import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string) { if (cond) pass += 1; else { fail += 1; console.error("FAIL", msg); } }

const graphRun = readFileSync("lib/factory/graphRun.ts", "utf8");

ok(/function otkRegenEnabled\(\): boolean \{[\s\S]*process\.env\.FACTORY_OTK_REGEN === "1"/.test(graphRun), "OTK regen is behind an explicit env flag");
ok(/otkRegenEnabled\(\) && \(plan\.renderCount \|\| 0\) < MAX_RENDERS/.test(graphRun), "OTK regen cannot exceed MAX_RENDERS");
ok(/artifact-check→regen[\s\S]*await regenCulprit\(db, origin, id, plan, niche, article, node, artifactDefects/.test(graphRun), "artifact-check failures can regenerate one culprit node when enabled");
ok(/typeof score === "number" && score < 7[\s\S]*const culprit = pickCulprit\(plan, axes\)/.test(graphRun), "low OTK score uses culprit selection");
ok(/await regenCulprit\(db, origin, id, plan, niche, article, culprit\.node, issues/.test(graphRun), "low OTK regen uses improve-prompt path through regenCulprit");
ok(/const status = summarizeWarnings\(plan\) \? "warning" : "done";/.test(graphRun), "default fail-open warning path remains after gated regen");

console.log(`otkRegenGate: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
