export const REELS_HOOK_TYPE_ENUM = [
  "curiosity_question",
  "warning_pattern_break",
  "list_promise",
  "before_after",
  "demo_review",
  "curiosity_gap",
  "direct_claim",
  "unknown",
] as const;

export const REELS_STRUCTURE_TYPE_ENUM = [
  "unboxing",
  "before_after",
  "review",
  "life_hack",
  "pov",
  "demo",
  "unknown_structure",
] as const;

type HookType = (typeof REELS_HOOK_TYPE_ENUM)[number];
type StructureType = (typeof REELS_STRUCTURE_TYPE_ENUM)[number];

export interface ReelsTaxonomyClassificationResult {
  id: number;
  niche: string;
  hook_type_v2: string;
  structure_v2: string;
  confidence: number;
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arr(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

function clampConfidence(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, Math.round(n * 100) / 100));
}

export function sanitizeOtherLabel(value: unknown): string | null {
  const cleaned = String(value || "")
    .toLowerCase()
    .replace(/^[\s:]+|[\s:]+$/g, "")
    .replace(/[^\p{L}\p{N}\s_-]+/gu, " ")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return cleaned || null;
}

export function normalizeHookTypeV2(value: unknown, fallback: HookType = "direct_claim"): string {
  const raw = String(value || "").trim().toLowerCase();
  if ((REELS_HOOK_TYPE_ENUM as readonly string[]).includes(raw)) return raw;
  if (raw.startsWith("other:")) {
    const label = sanitizeOtherLabel(raw.slice(6));
    return label ? `other:${label}` : fallback;
  }
  return fallback;
}

export function normalizeStructureTypeV2(value: unknown, fallback: StructureType = "unknown_structure"): string {
  const raw = String(value || "").trim().toLowerCase();
  if ((REELS_STRUCTURE_TYPE_ENUM as readonly string[]).includes(raw)) return raw;
  if (raw.startsWith("other:")) {
    const label = sanitizeOtherLabel(raw.slice(6));
    return label ? `other:${label}` : fallback;
  }
  return fallback;
}

export function taxonomyPromptBlock(): string {
  return [
    "Классифицируй каждый ролик в JSON-массиве.",
    `hook_type_v2: one of [${REELS_HOOK_TYPE_ENUM.join(", ")}] or other:<label>.`,
    `structure_v2: one of [${REELS_STRUCTURE_TYPE_ENUM.join(", ")}] or other:<label>.`,
    "confidence: 0..1.",
    "Если не уверен, лучше оставь direct_claim или unknown_structure, чем выдумывать.",
    "Верни только JSON-массив объектов вида {id, hook_type_v2, structure_v2, confidence}.",
  ].join("\n");
}

export function mergeTaxonomyPlaybook(
  playbook: unknown,
  rows: ReelsTaxonomyClassificationResult[],
  threshold = 3,
): { playbook: Record<string, unknown>; promoted_hooks: string[]; promoted_structures: string[] } {
  const pb = rec(playbook);
  const taxonomy = rec(pb.reels_brain_taxonomy);
  const stats = rec(taxonomy.other_label_counts);
  const hookStats = { ...rec(stats.hooks) };
  const structureStats = { ...rec(stats.structures) };
  const customHookLabels = new Set(arr(taxonomy.custom_hook_labels));
  const customStructureLabels = new Set(arr(taxonomy.custom_structure_labels));
  const promotedHooks: string[] = [];
  const promotedStructures: string[] = [];

  for (const row of rows) {
    if (row.hook_type_v2.startsWith("other:")) {
      const label = sanitizeOtherLabel(row.hook_type_v2.slice(6));
      if (label) {
        hookStats[label] = Number(hookStats[label] || 0) + 1;
        if (Number(hookStats[label]) >= threshold && !customHookLabels.has(label)) {
          customHookLabels.add(label);
          promotedHooks.push(label);
        }
      }
    }
    if (row.structure_v2.startsWith("other:")) {
      const label = sanitizeOtherLabel(row.structure_v2.slice(6));
      if (label) {
        structureStats[label] = Number(structureStats[label] || 0) + 1;
        if (Number(structureStats[label]) >= threshold && !customStructureLabels.has(label)) {
          customStructureLabels.add(label);
          promotedStructures.push(label);
        }
      }
    }
  }

  return {
    playbook: {
      ...pb,
      reels_brain_taxonomy: {
        ...taxonomy,
        custom_hook_labels: Array.from(customHookLabels).sort(),
        custom_structure_labels: Array.from(customStructureLabels).sort(),
        other_label_counts: {
          ...stats,
          hooks: hookStats,
          structures: structureStats,
        },
        taxonomy_updated_at: new Date().toISOString(),
      },
    },
    promoted_hooks: promotedHooks,
    promoted_structures: promotedStructures,
  };
}

