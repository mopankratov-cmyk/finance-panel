import { deepStrictEqual, strictEqual } from "node:assert";
import { LANE_BUDGET, routeNode, routeRecipeLane } from "./renderRouter";

deepStrictEqual(routeNode({ tool_candidate: "creatify" }), {
  lane: "ugc",
  tool: "creatify",
  reason: "tool is UGC provider",
});

strictEqual(routeNode({ node_type: "talking_head" }).lane, "ugc", "talking_head routes to ugc");
strictEqual(routeNode({ node_type: "product_motion" }).lane, "product", "product motion routes to product");
strictEqual(routeNode({ tool_candidate: "seedance" }).lane, "product", "seedance routes to product");
strictEqual(routeNode({ render_role: "нет" }).tool, "disk_real", "no-render role defaults to disk_real");
strictEqual(routeNode({ footage: "real" }).tool, "disk_real", "real footage defaults to disk_real");
strictEqual(routeNode({}).tool, "seedance", "empty visual node defaults to seedance product lane");

strictEqual(routeRecipeLane([{ tool_candidate: "seedance" }, { tool_candidate: "kling" }]), "product", "all product nodes keep product lane");
strictEqual(routeRecipeLane([{ tool_candidate: "creatify" }]), "ugc", "all ugc nodes keep ugc lane");
strictEqual(routeRecipeLane([{ tool_candidate: "creatify" }, { tool_candidate: "seedance" }]), "hybrid", "mixed product+ugc routes to hybrid");
strictEqual(LANE_BUDGET.product, 3, "product budget is conservative");
strictEqual(LANE_BUDGET.ugc, 2, "ugc budget is tighter");
strictEqual(LANE_BUDGET.hybrid, 4, "hybrid budget allows both lanes");

console.log("renderRouter: passed");
