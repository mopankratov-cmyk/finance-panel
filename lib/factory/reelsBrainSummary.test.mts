import { buildReelsBrainPlatformSummary } from "./reelsBrainSummary";

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { fail++; console.error("✗", m); } }
function eq(a: unknown, b: unknown, m: string) { ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)})`); }

{
  const summary = buildReelsBrainPlatformSummary({
    videos: [
      { platform: "tiktok", virality_score: 12, analyzed: true, hook_text: "Не покупай это", format_detected: "demo", sound_title: "summer", source_orbit_id: "apify_tiktok:water" },
      { platform: "tiktok", virality_score: 18, analyzed: false, hook_text: "Не покупай это", format_detected: "demo", sound_title: "summer", source_orbit_id: "apify_tiktok:water" },
      { platform: "instagram", virality_score: 20, analyzed: true, hook_text: "До и после", format_detected: "before_after", sound_title: "clean", source_orbit_id: "apify_instagram:closet" },
    ],
    winners: [
      { winner_learnings: { hook: "Не покупай это", target_platform: "tiktok" } },
      { winner_learnings: { hook: "До и после", target_platform: "instagram" } },
    ],
    patternCounts: { tiktok: 4, instagram: 2 },
  });

  eq(summary[0].platform, "tiktok", "summary: first platform tiktok");
  eq(summary[0].videos, 2, "summary: tiktok videos");
  eq(summary[0].avg_score, 15, "summary: tiktok avg score");
  eq(summary[0].top_hooks[0], "Не покупай это", "summary: tiktok top hook");
  eq(summary[0].winners, 1, "summary: tiktok winners");
  eq(summary[0].source_providers[0], { provider: "apify_tiktok", count: 2 }, "summary: provider counts");
  eq(summary[1].pattern_count, 2, "summary: pattern count by platform");
}

{
  const summary = buildReelsBrainPlatformSummary({
    videos: [
      { platform: "tiktok", virality_score: 31, analyzed: true, hook_text: "Рынок хук 1", format_detected: "demo", sound_title: "trend", source_orbit_id: "apify_tiktok:one", caption: null },
      { platform: "tiktok", virality_score: 27, analyzed: true, hook_text: "Рынок хук 2", format_detected: "demo", sound_title: "trend", source_orbit_id: "apify_tiktok:two", caption: null },
      { platform: "youtube", virality_score: 19, analyzed: true, hook_text: "Shorts хук", format_detected: "review", sound_title: "clean", source_orbit_id: "apify_youtube:one", caption: null },
    ],
    winners: [],
    patternCounts: {},
  });

  eq(summary[0].winners, 2, "summary: synthetic tiktok winners fill readiness gap");
  eq(summary[0].top_winner_hooks.slice(0, 2), ["Рынок хук 1", "Рынок хук 2"], "summary: synthetic winner hooks come from top analyzed corpus");
  eq(summary[2].winners, 1, "summary: synthetic youtube winner fills readiness gap");
}

console.log(`\nreelsBrainSummary: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
