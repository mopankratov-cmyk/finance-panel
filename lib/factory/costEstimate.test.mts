import { estimateRunCost, REGEN_FACTOR } from "./costEstimate";

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string) { if (cond) pass += 1; else { fail += 1; console.error("FAIL", msg); } }
function eq(a: unknown, b: unknown, msg: string) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`); }

{
  const hint = estimateRunCost([
    { tool: "seedance", node_type: "b_roll" },
    { tool: "disk_real", node_type: "proof" },
    { tool: "elevenlabs", node_type: "voiceover" },
    { tool: "sound", node_type: "music" },
  ]);
  eq(hint.typical_usd, 0.6, "known paid tools plus one assembly render are estimated");
  eq(hint.worst_case_usd, 1.8, "worst case uses regen factor");
  ok(hint.lines.some((l) => l.tool === "shotstack"), "assembly cost is included once");
  eq(hint.regen_factor, REGEN_FACTOR, "regen factor is exported with hint");
}

{
  const hint = estimateRunCost([
    { tool: "", node_type: "hook" },
    { tool: null, node_type: "b_roll" },
    { node_type: "captions" },
  ]);
  eq(hint.typical_usd, 1.08, "unconfigured generative drafts get conservative fallback plus assembly");
  ok(hint.fallback_used, "draft fallback is explicit");
}

{
  const hint = estimateRunCost([{ tool: "disk_real", node_type: "proof" }]);
  eq(hint.typical_usd, 0.08, "real footage still accounts for final assembly");
  ok(!hint.fallback_used, "free real-footage recipes do not get draft fallback");
}

console.log(`costEstimate: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
