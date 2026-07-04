import { buildPatternOutcomeLayer } from "./reelsBrainPatternOutcome";

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { fail++; console.error("✗", m); } }
function eq(a: unknown, b: unknown, m: string) { ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)})`); }

{
  const rows = buildPatternOutcomeLayer([
    {
      id: "p1",
      quality_gate: "high_confidence",
      platforms: ["tiktok"],
    },
  ], [
    { platform: "tiktok", views: 22000, completion_rate: 0.52, ctr_card: 0.02, marketplace_orders: 2 },
    { platform: "tiktok", views: 13000, completion_rate: 0.41, saves: 66 },
  ]);

  eq(rows[0]?.status, "proven", "pattern outcome: strong platform is proven");
  eq(rows[0]?.final_decision, "scale", "pattern outcome: proven + strong quality scales");
}

{
  const rows = buildPatternOutcomeLayer([
    {
      id: "p2",
      quality_gate: "medium_confidence",
      platforms: ["instagram"],
    },
  ], [
    { platform: "instagram", views: 620, completion_rate: 0.12, ctr_card: 0.003 },
    { platform: "instagram", views: 710, completion_rate: 0.18, ctr_card: 0.005 },
  ]);

  eq(rows[0]?.status, "weak", "pattern outcome: weak feedback lowers pattern");
  eq(rows[0]?.final_decision, "watch", "pattern outcome: weak feedback forces watch");
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
