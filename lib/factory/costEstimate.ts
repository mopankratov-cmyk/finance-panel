export const TOOL_COST_USD: Record<string, number> = {
  seedance: 0.42,
  seedance_fast: 0.14,
  seedance_pro: 0.42,
  kling: 0.38,
  kling_pro: 0.5,
  pika: 0.3,
  creatify: 1.2,
  shotstack: 0.08,
  higgsfield: 0.5,
  gemini: 0.4,
  elevenlabs: 0.1,
};

export const DEFAULT_DRAFT_RECIPE_COST_USD = 3.2;
export const UNKNOWN_PAID_TOOL_COST_USD = 0.4;
export const REGEN_FACTOR = 3;

export interface CostLine {
  tool: string;
  label: string;
  count: number;
  unit_usd: number;
  total_usd: number;
}

export interface RunCostHint {
  currency: "USD";
  typical_usd: number;
  worst_case_usd: number;
  regen_factor: number;
  lines: CostLine[];
  priced_nodes: number;
  generative_nodes: number;
  fallback_used: boolean;
}

const FREE_TOOLS = new Set(["disk", "disk_real", "sound", "music", "captions", "caption", "transition"]);
const NON_GENERATIVE_TYPES = new Set(["captions", "caption", "music", "sound", "transition"]);

function money(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function normalizeTool(tool: unknown): string {
  const t = String(tool || "").trim().toLowerCase();
  if (t === "seedance_pro") return "seedance";
  return t;
}

function isGenerativeNode(n: Record<string, unknown>): boolean {
  const kind = String(n.node_type || n.slot || "").toLowerCase();
  return !NON_GENERATIVE_TYPES.has(kind);
}

export function estimateRunCost(nodes: Record<string, unknown>[] | null | undefined): RunCostHint {
  const rows = (nodes || []).filter(Boolean);
  const counts: Record<string, number> = {};
  let pricedNodes = 0;
  let unconfiguredGenerative = 0;
  let generativeNodes = 0;

  for (const n of rows) {
    if (isGenerativeNode(n)) generativeNodes += 1;
    const tool = normalizeTool(n.tool);
    if (!tool) {
      if (isGenerativeNode(n)) unconfiguredGenerative += 1;
      continue;
    }
    if (FREE_TOOLS.has(tool)) continue;
    counts[tool] = (counts[tool] || 0) + 1;
    pricedNodes += 1;
  }

  let fallbackUsed = false;
  const lines: CostLine[] = Object.keys(counts).sort().map((tool) => {
    const unit = TOOL_COST_USD[tool] ?? UNKNOWN_PAID_TOOL_COST_USD;
    const count = counts[tool];
    return { tool, label: tool, count, unit_usd: unit, total_usd: money(unit * count) };
  });

  if (unconfiguredGenerative > 0 && pricedNodes === 0) {
    const total = Math.min(DEFAULT_DRAFT_RECIPE_COST_USD, unconfiguredGenerative * 0.5);
    lines.push({ tool: "draft_estimate", label: "draft_estimate", count: unconfiguredGenerative, unit_usd: money(total / unconfiguredGenerative), total_usd: money(total) });
    fallbackUsed = true;
  }

  if (rows.length && !lines.some((l) => l.tool === "shotstack")) {
    lines.push({ tool: "shotstack", label: "shotstack", count: 1, unit_usd: TOOL_COST_USD.shotstack, total_usd: TOOL_COST_USD.shotstack });
  }

  const typical = money(lines.reduce((sum, l) => sum + l.total_usd, 0));
  return {
    currency: "USD",
    typical_usd: typical,
    worst_case_usd: money(typical * REGEN_FACTOR),
    regen_factor: REGEN_FACTOR,
    lines,
    priced_nodes: pricedNodes,
    generative_nodes: generativeNodes,
    fallback_used: fallbackUsed,
  };
}
