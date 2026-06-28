export type FactoryLane = "product" | "ugc" | "hybrid";

export interface RouterIn {
  node_type?: string | null;
  tool_candidate?: string | null;
  render_role?: string | null;
  footage?: string | null;
  target_platform?: string | null;
}

export interface RouterOut {
  lane: FactoryLane;
  tool: string;
  reason: string;
}

export const LANE_BUDGET: Record<FactoryLane, number> = {
  product: 3,
  ugc: 2,
  hybrid: 4,
};

const PRODUCT_TOOLS = new Set(["seedance", "seedance_fast", "seedance_pro", "kling", "kling_pro", "pika", "disk_real", "disk"]);
const UGC_TOOLS = new Set(["creatify"]);

function norm(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export function routeNode(input: RouterIn): RouterOut {
  const tool = norm(input.tool_candidate);
  const nodeType = norm(input.node_type);
  const renderRole = norm(input.render_role);
  const footage = norm(input.footage);

  if (tool && UGC_TOOLS.has(tool)) return { lane: "ugc", tool, reason: "tool is UGC provider" };
  if (nodeType.includes("talking_head") || nodeType.includes("ugc") || nodeType.includes("avatar")) {
    return { lane: "ugc", tool: tool || "creatify", reason: "node type is UGC/talking-head" };
  }
  if (footage === "real" || renderRole === "нет" || renderRole === "none") {
    return { lane: "product", tool: tool || "disk_real", reason: "real footage or no AI render role" };
  }
  if (tool && PRODUCT_TOOLS.has(tool)) return { lane: "product", tool, reason: "tool is product/media provider" };
  if (nodeType.includes("product") || nodeType.includes("motion") || nodeType.includes("before_after")) {
    return { lane: "product", tool: tool || "seedance", reason: "node type is product motion" };
  }
  return { lane: "product", tool: tool || "seedance", reason: "default product lane" };
}

export function routeRecipeLane(nodes: Array<RouterIn & { lane?: FactoryLane | null }>): FactoryLane {
  const lanes = nodes.map((node) => node.lane || routeNode(node).lane);
  const hasProduct = lanes.includes("product");
  const hasUgc = lanes.includes("ugc");
  if (hasProduct && hasUgc) return "hybrid";
  if (hasUgc) return "ugc";
  return "product";
}
