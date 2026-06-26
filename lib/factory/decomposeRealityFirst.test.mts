import { applyRealityFirstRouting } from "./decomposeRouting";

let passed = 0;
let failed = 0;

function ok(cond: boolean, msg: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", msg);
  }
}

type RoutingNode = { role: string; node_type: string; tool_candidate: string; routing_note?: string };

const routed = applyRealityFirstRouting<RoutingNode>([
  { role: "problem", node_type: "b_roll", tool_candidate: "seedance" },
  { role: "solution", node_type: "ai_product_render", tool_candidate: "creatify" },
  { role: "proof", node_type: "pov", tool_candidate: "kling" },
  { role: "proof", node_type: "before_after", tool_candidate: "seedance" },
  { role: "problem", node_type: "talking_head", tool_candidate: "creatify" },
  { role: "hook", node_type: "hook_ugc", tool_candidate: "seedance" },
]);

ok(routed[0].tool_candidate === "disk_real", "problem b-roll is forced to disk_real");
ok(routed[1].tool_candidate === "disk_real", "solution render is forced to disk_real");
ok(routed[2].tool_candidate === "disk_real", "proof pov is forced to disk_real");
ok(/reality_first/.test(String(routed[2].routing_note || "")), "forced routes keep an audit note");
ok(routed[3].tool_candidate === "seedance", "before_after can keep seedance as an AI accent");
ok(routed[4].tool_candidate === "creatify", "talking_head can keep creatify");
ok(routed[5].tool_candidate === "seedance", "hook can keep seedance");

if (failed) process.exit(1);
console.log(`decomposeRealityFirst: ${passed} passed, ${failed} failed`);
