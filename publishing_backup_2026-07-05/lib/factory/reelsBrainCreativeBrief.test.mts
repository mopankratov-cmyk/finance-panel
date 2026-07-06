import { selectCreativeBriefBrainWithTrust } from "./reelsBrainCreativeBrief";

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { fail++; console.error("✗", m); } }
function eq(a: unknown, b: unknown, m: string) { ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)})`); }

{
  const decision = selectCreativeBriefBrainWithTrust({
    platform: "tiktok",
    playbook: {
      reels_brain_patterns: {
        meta_brain: {
          total_videos: 120,
          analyzed_videos: 60,
          patterns: new Array(10).fill(null).map((_, index) => ({ pattern_id: `m${index}` })),
          generator_ready_patterns: new Array(4).fill(null).map((_, index) => ({ pattern_id: `mr${index}` })),
          anti_patterns: [],
          quality_summary: { avg_relevance_score: 68 },
        },
        platform_brains: {
          tiktok: {
            total_videos: 70,
            analyzed_videos: 32,
            patterns: new Array(8).fill(null).map((_, index) => ({ pattern_id: `t${index}` })),
            generator_ready_patterns: new Array(4).fill(null).map((_, index) => ({ pattern_id: `tr${index}` })),
            anti_patterns: [{ label: "singleton", severity: "medium" }],
            quality_summary: { avg_relevance_score: 74 },
          },
        },
      },
    },
  });

  eq(decision.selected_scope, "platform", "brief trust: strong platform brain stays selected");
  eq(decision.recommended_mode, "primary", "brief trust: strong platform can be primary");
  ok(decision.reasons.some((item) => item.includes("platform-specific")), "brief trust: explains platform selection");
  eq(decision.rebuild_alignment.status, "unknown", "brief trust: missing rebuild context stays unknown");
}

{
  const decision = selectCreativeBriefBrainWithTrust({
    platform: "youtube",
    playbook: {
      reels_brain_patterns: {
        meta_brain: {
          total_videos: 180,
          analyzed_videos: 84,
          patterns: new Array(14).fill(null).map((_, index) => ({ pattern_id: `m${index}` })),
          generator_ready_patterns: new Array(6).fill(null).map((_, index) => ({ pattern_id: `mr${index}` })),
          anti_patterns: [],
          quality_summary: { avg_relevance_score: 72 },
        },
        rebuild_context: {
          execution_mode: "brief_bundle_completion",
          focus_platform: "youtube",
          brief_bundle_biased: true,
          output_ready_biased: true,
        },
        platform_brains: {
          youtube: {
            total_videos: 8,
            analyzed_videos: 2,
            patterns: [{ pattern_id: "y1" }],
            generator_ready_patterns: [],
            anti_patterns: [{ label: "off niche", severity: "high" }],
            quality_summary: { avg_relevance_score: 28 },
          },
          tiktok: {
            total_videos: 90,
            analyzed_videos: 40,
            patterns: new Array(8).fill(null).map((_, index) => ({ pattern_id: `t${index}` })),
            generator_ready_patterns: new Array(4).fill(null).map((_, index) => ({ pattern_id: `tr${index}` })),
            anti_patterns: [],
            quality_summary: { avg_relevance_score: 75 },
          },
          instagram: {
            total_videos: 60,
            analyzed_videos: 20,
            patterns: new Array(5).fill(null).map((_, index) => ({ pattern_id: `i${index}` })),
            generator_ready_patterns: new Array(2).fill(null).map((_, index) => ({ pattern_id: `ir${index}` })),
            anti_patterns: [],
            quality_summary: { avg_relevance_score: 63 },
          },
        },
      },
    },
  });

  eq(decision.selected_scope, "meta", "brief trust: weak platform falls back to meta brain");
  eq(decision.recommended_mode, "primary", "brief trust: strong meta brain can still be primary");
  ok(decision.reasons.some((item) => item.includes("fallback")), "brief trust: explains fallback");
  eq(decision.rebuild_alignment.status, "aligned", "brief trust: rebuild context can align with requested platform");
  ok((decision.rebuild_context?.brief_bundle_biased), "brief trust: exposes rebuild context to downstream");
}

{
  const decision = selectCreativeBriefBrainWithTrust({
    platform: "instagram",
    playbook: {
      reels_brain_patterns: {
        meta_brain: {
          total_videos: 40,
          analyzed_videos: 10,
          patterns: new Array(3).fill(null).map((_, index) => ({ pattern_id: `m${index}` })),
          generator_ready_patterns: [],
          anti_patterns: [{ label: "low fit", severity: "high" }],
          quality_summary: { avg_relevance_score: 39 },
        },
        rebuild_context: {
          execution_mode: "ship_ready_generation",
          focus_platform: "tiktok",
          ship_ready_biased: true,
          output_ready_biased: true,
        },
        platform_brains: {
          instagram: {
            total_videos: 16,
            analyzed_videos: 5,
            patterns: new Array(2).fill(null).map((_, index) => ({ pattern_id: `i${index}` })),
            generator_ready_patterns: [],
            anti_patterns: [{ label: "singleton", severity: "medium" }],
            quality_summary: { avg_relevance_score: 42 },
          },
        },
      },
    },
  });

  eq(decision.recommended_mode, "control_only", "brief trust: weak platform can downgrade into control-only via safer meta fallback");
  ok(!decision.allow_primary_use, "brief trust: weak brain cannot be primary");
  eq(decision.rebuild_alignment.status, "partial", "brief trust: foreign platform focus but output-ready rebuild stays partial, not blind mismatch");
  ok(decision.rebuild_alignment.reasons.some((item) => item.includes("а не под instagram")), "brief trust: mismatch reason names wrong platform focus");
}

{
  const decision = selectCreativeBriefBrainWithTrust({
    platform: "tiktok",
    playbook: {
      reels_brain_patterns: {
        meta_brain: {
          total_videos: 120,
          analyzed_videos: 60,
          patterns: new Array(10).fill(null).map((_, index) => ({ pattern_id: `m${index}` })),
          generator_ready_patterns: new Array(4).fill(null).map((_, index) => ({ pattern_id: `mr${index}` })),
          anti_patterns: [],
          quality_summary: { avg_relevance_score: 70 },
        },
        platform_brains: {
          tiktok: {
            total_videos: 80,
            analyzed_videos: 40,
            patterns: new Array(8).fill(null).map((_, index) => ({ pattern_id: `t${index}` })),
            generator_ready_patterns: new Array(4).fill(null).map((_, index) => ({ pattern_id: `tr${index}` })),
            anti_patterns: [],
            quality_summary: { avg_relevance_score: 76 },
          },
        },
      },
    },
    corpusRows: [
      { platform: "tiktok", analyzed: true, analyzed_full: { reels_seed: { transcript: "", audio_features: {}, pipeline: {} } } },
      { platform: "tiktok", analyzed: true, analyzed_full: { reels_seed: { transcript: "", audio_features: {}, pipeline: {} } } },
      { platform: "tiktok", analyzed: true, analyzed_full: { reels_seed: { transcript: "", audio_features: {}, pipeline: {} } } },
      { platform: "tiktok", analyzed: true, analyzed_full: { reels_seed: { transcript: "", audio_features: {}, pipeline: {} } } },
      { platform: "tiktok", analyzed: true, analyzed_full: { reels_seed: { transcript: "", audio_features: {}, pipeline: {} } } },
      { platform: "tiktok", analyzed: true, analyzed_full: { reels_seed: { transcript: "", audio_features: {}, pipeline: {} } } },
    ],
  });

  eq(decision.trust.audio_support?.status, "weak", "brief trust: thin audio layer is detected");
  eq(decision.recommended_mode, "control_only", "brief trust: strong pattern brain but weak audio layer degrades to control_only");
  ok(!decision.allow_primary_use, "brief trust: weak audio layer blocks blind primary use");
  ok(decision.reasons.some((item) => item.includes("audio weak")), "brief trust: reasons mention audio downgrade");
}

console.log(`\nreelsBrainCreativeBrief: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
