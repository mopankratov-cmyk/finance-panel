import { buildPatternOutcomeLayer } from "./reelsBrainPatternOutcome";

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { fail++; console.error("✗", m); } }
function eq(a: unknown, b: unknown, m: string) { ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)})`); }

{
  const rows = buildPatternOutcomeLayer([
    {
      id: "p1",
      quality_gate: "high_confidence",
      niches: ["ru_toys"],
      platforms: ["tiktok"],
    },
  ], [
    { platform: "tiktok", niche: "ru_toys", views: 22000, completion_rate: 0.52, ctr_card: 0.02, marketplace_orders: 2 },
    { platform: "tiktok", niche: "ru_toys", views: 13000, completion_rate: 0.41, saves: 66 },
  ]);

  eq(rows[0]?.status, "proven", "pattern outcome: strong platform is proven");
  eq(rows[0]?.final_decision, "scale", "pattern outcome: proven + strong quality scales");
  eq(rows[0]?.best_segment, "ru_toys × tiktok", "pattern outcome: best segment is persisted");
}

{
  const rows = buildPatternOutcomeLayer([
    {
      id: "p2",
      quality_gate: "medium_confidence",
      niches: ["ru_cosmetics"],
      platforms: ["instagram"],
    },
  ], [
    { platform: "instagram", niche: "ru_cosmetics", views: 620, completion_rate: 0.12, ctr_card: 0.003 },
    { platform: "instagram", niche: "ru_cosmetics", views: 710, completion_rate: 0.18, ctr_card: 0.005 },
  ]);

  eq(rows[0]?.status, "weak", "pattern outcome: weak feedback lowers pattern");
  eq(rows[0]?.final_decision, "watch", "pattern outcome: weak feedback forces watch");
}

{
  const rows = buildPatternOutcomeLayer([
    {
      id: "p4",
      quality_gate: "high_confidence",
      niches: ["ru_toys"],
      platforms: ["tiktok"],
    },
  ], [
    { platform: "tiktok", niche: "ru_cosmetics", views: 24000, completion_rate: 0.56, marketplace_orders: 3 },
    { platform: "tiktok", niche: "ru_cosmetics", views: 18000, completion_rate: 0.49, saves: 80 },
  ]);

  eq(rows[0]?.status, "no_feedback", "pattern outcome: other niche winners do not leak into segment");
  eq(rows[0]?.platform_signals[0]?.total_posts, 0, "pattern outcome: platform summary is scoped to matching niches");
}

{
  const rows = buildPatternOutcomeLayer([
    {
      id: "p3",
      quality_gate: "high_confidence",
      platforms: [],
    },
  ], []);

  eq(rows[0]?.status, "no_feedback", "pattern outcome: no mapping means no feedback");
  eq(rows[0]?.final_decision, "control", "pattern outcome: strong quality without feedback stays control");
}

console.log(`\nreelsBrainPatternOutcome: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
