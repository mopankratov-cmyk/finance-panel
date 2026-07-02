import {
  mergeTaxonomyPlaybook,
  normalizeHookTypeV2,
  normalizeStructureTypeV2,
  sanitizeOtherLabel,
} from "./reelsBrainTaxonomy";

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { fail++; console.error("✗", m); } }
function eq(a: unknown, b: unknown, m: string) { ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)})`); }

{
  eq(sanitizeOtherLabel(" UGC confession "), "ugc_confession", "taxonomy: sanitize other label");
  eq(normalizeHookTypeV2("other:UGC confession"), "other:ugc_confession", "taxonomy: normalize hook other label");
  eq(normalizeStructureTypeV2("other:fast reveal"), "other:fast_reveal", "taxonomy: normalize structure other label");
  eq(normalizeHookTypeV2("weird", "direct_claim"), "direct_claim", "taxonomy: fallback unknown hook");
}

{
  const merged = mergeTaxonomyPlaybook({
    reels_brain_taxonomy: {
      custom_hook_labels: ["already_known"],
      other_label_counts: {
        hooks: { ugc_confession: 2 },
        structures: {},
      },
    },
  }, [
    { id: 1, niche: "ru_toys", hook_type_v2: "other:ugc_confession", structure_v2: "review", confidence: 0.8 },
    { id: 2, niche: "ru_toys", hook_type_v2: "other:new_angle", structure_v2: "other:fast_reveal", confidence: 0.7 },
    { id: 3, niche: "ru_toys", hook_type_v2: "warning_pattern_break", structure_v2: "other:fast_reveal", confidence: 0.7 },
    { id: 4, niche: "ru_toys", hook_type_v2: "other:new_angle", structure_v2: "other:fast_reveal", confidence: 0.6 },
  ], 3);

  ok(merged.promoted_hooks.includes("ugc_confession"), "taxonomy: promotes frequent hook label");
  ok(merged.promoted_structures.includes("fast_reveal"), "taxonomy: promotes frequent structure label");
  ok((merged.playbook.reels_brain_taxonomy as Record<string, unknown>).custom_hook_labels instanceof Array, "taxonomy: stores custom hook labels");
}

console.log(`\nreelsBrainTaxonomy: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
