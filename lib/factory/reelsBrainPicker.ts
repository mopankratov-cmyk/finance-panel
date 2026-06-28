import type { SupabaseClient } from "@supabase/supabase-js";
import type { RunPlan } from "./graphTypes";
import type { ReelsPatternMemoryItem } from "./reelsBrainPatterns";

type Row = Record<string, unknown>;

export interface PickedReelsBrainPattern {
  pattern_id: string;
  hook_type: string;
  structure_type: string;
  retention_mechanism: string;
  emotion?: string | null;
  viral_logic?: string | null;
  example_hooks: string[];
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, max = 180): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function scorePattern(pattern: ReelsPatternMemoryItem): number {
  const strength = Number(pattern.strength_score) || 0;
  const frequency = Number(pattern.frequency) || 0;
  const views = Number(pattern.avg_views) || 0;
  return strength * 1000 + Math.log10(Math.max(1, views)) * 20 + Math.log1p(frequency) * 10;
}

function normalizePattern(pattern: ReelsPatternMemoryItem): PickedReelsBrainPattern | null {
  const patternId = text(pattern.pattern_id, 80);
  if (!patternId) return null;
  return {
    pattern_id: patternId,
    hook_type: text(pattern.hook_type, 80) || "direct_claim",
    structure_type: text(pattern.structure_type, 80) || "unknown_structure",
    retention_mechanism: text(pattern.retention_mechanism, 80) || "open_loop",
    emotion: text(pattern.emotion, 60) || null,
    viral_logic: text(pattern.viral_logic, 180) || null,
    example_hooks: asArray(pattern.hooks).map((hook) => text(hook, 140)).filter(Boolean).slice(0, 3),
  };
}

function pickIndex(seed: string, length: number): number {
  if (length <= 1) return 0;
  let hash = 0;
  for (const ch of seed) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  return Math.abs(hash) % Math.min(3, length);
}

export async function pickReelsBrainPattern(
  db: SupabaseClient,
  niche: string | null | undefined,
  seed = "",
): Promise<PickedReelsBrainPattern | null> {
  const key = text(niche, 80);
  if (!key) return null;
  try {
    const { data } = await db
      .from("niche_playbooks")
      .select("playbook")
      .eq("niche", key)
      .limit(1);
    const playbook = ((data as Row[] | null)?.[0]?.playbook || {}) as Row;
    const memory = (playbook.reels_brain_patterns && typeof playbook.reels_brain_patterns === "object")
      ? playbook.reels_brain_patterns as Row
      : {};
    const patterns = asArray(memory.patterns) as ReelsPatternMemoryItem[];
    const ranked = patterns
      .map(normalizePatternCandidate)
      .filter((item): item is ReelsPatternMemoryItem => !!item)
      .sort((a, b) => scorePattern(b) - scorePattern(a));
    const picked = ranked[pickIndex(seed || key, ranked.length)];
    return picked ? normalizePattern(picked) : null;
  } catch {
    return null;
  }
}

function normalizePatternCandidate(value: unknown): ReelsPatternMemoryItem | null {
  if (!value || typeof value !== "object") return null;
  const row = value as ReelsPatternMemoryItem;
  return text(row.pattern_id, 80) ? row : null;
}

export function applyReelsBrainPatternToPlan(plan: RunPlan, pattern: PickedReelsBrainPattern | null): boolean {
  if (!pattern) return false;
  plan.reels_brain_pattern = {
    pattern_id: pattern.pattern_id,
    hook_type: pattern.hook_type,
    structure_type: pattern.structure_type,
    retention_mechanism: pattern.retention_mechanism,
    emotion: pattern.emotion || null,
    viral_logic: pattern.viral_logic || null,
    example_hooks: pattern.example_hooks,
  };
  const hookNode = plan.nodes.find((node) => {
    const params = (node.params || {}) as Row;
    return String(params.role || node.slot || "").toLowerCase() === "hook";
  }) || plan.nodes[0];
  if (!hookNode) return true;
  const params = (hookNode.params || {}) as Row;
  params.reels_brain_pattern = plan.reels_brain_pattern;
  params.hook_type = params.hook_type || pattern.hook_type;
  params.structure_type = params.structure_type || pattern.structure_type;
  params.retention_mechanism = params.retention_mechanism || pattern.retention_mechanism;
  hookNode.params = params;
  const cue = [
    `reels_brain_pattern=${pattern.pattern_id}`,
    `hook_type=${pattern.hook_type}`,
    `structure=${pattern.structure_type}`,
    `retention=${pattern.retention_mechanism}`,
    pattern.example_hooks.length ? `examples=${pattern.example_hooks.join(" | ")}` : "",
  ].filter(Boolean).join("; ");
  if (cue && !hookNode.prompt.includes("reels_brain_pattern=")) {
    hookNode.prompt = `${hookNode.prompt}\n\n${cue}`.trim();
  }
  return true;
}
