import { buildNicheTrustSummary, buildOutcomeSignal, buildPatternTrustSummary } from "./reelsBrainTrust";

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { fail++; console.error("✗", m); } }
function eq(a: unknown, b: unknown, m: string) { ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)})`); }

{
  const trust = buildPatternTrustSummary({
    niche: "ru_toys",
    platform: "tiktok",
    total_videos: 120,
    analyzed_videos: 52,
    patterns: new Array(12).fill(null).map((_, index) => ({ pattern_id: `p${index}` })),
    generator_ready_patterns: new Array(5).fill(null).map((_, index) => ({ pattern_id: `r${index}` })),
    anti_patterns: [
      { anti_pattern_id: "a1", label: "Офф-нишевый шум", severity: "high", trigger_reason: "low_niche_relevance", affected_patterns: 2, total_frequency: 5, avg_quality_score: 22, avg_relevance_score: 19, examples: [], action: "drop" },
      { anti_pattern_id: "a2", label: "Одиночный залёт", severity: "medium", trigger_reason: "singleton_pattern", affected_patterns: 1, total_frequency: 1, avg_quality_score: 30, avg_relevance_score: 25, examples: [], action: "watch" },
    ],
    top_hooks: [],
    quality_summary: { generator_ready: 5, needs_cleanup: 4, noise: 3, avg_relevance_score: 67 },
    generated_at: "2026-07-04T00:00:00.000Z",
  } as any, {
    platform: "tiktok",
    ready: true,
    score: 92,
    videos: 120,
    analyzed: 52,
    patterns: 12,
    winners: 3,
    gates: { min_videos: 40, min_analyzed: 16, min_patterns: 6, min_winners: 2 },
    missing: [],
  });

  ok(trust.score >= 70, "trust: strong brain scores high");
  eq(trust.status, "ready", "trust: strong brain is ready");
  eq(trust.confidence, "high", "trust: strong brain confidence high");
  ok(trust.top_risks.includes("Офф-нишевый шум"), "trust: anti-pattern labels surface");
}

{
  const outcome = buildOutcomeSignal([
    { platform: "tiktok", views: 22000, completion_rate: 0.49, ctr_card: 0.022, marketplace_orders: 2 },
    { platform: "tiktok", views: 14000, completion_rate: 0.41, ctr_card: 0.018, saves: 80 },
  ], "tiktok");
  eq(outcome.status, "proven", "outcome: strong posts produce proven signal");
  eq(outcome.confidence, "medium", "outcome: two posts give medium confidence");
}

{
  const outcome = buildOutcomeSignal([
    { platform: "instagram", views: 700, completion_rate: 0.12, ctr_card: 0.004 },
    { platform: "instagram", views: 820, completion_rate: 0.18, ctr_card: 0.006 },
  ], "instagram");
  eq(outcome.status, "weak", "outcome: weak posts degrade signal");
  ok(outcome.losers >= 2, "outcome: weak posts counted as losers");
}

{
  const trust = buildPatternTrustSummary({
    niche: "ru_clothing",
    platform: "instagram",
    total_videos: 18,
    analyzed_videos: 4,
    patterns: [{ pattern_id: "p1" }],
    generator_ready_patterns: [],
    anti_patterns: [
      { anti_pattern_id: "a1", label: "Taxonomy не хватает", severity: "low", trigger_reason: "unknown_niche_taxonomy", affected_patterns: 1, total_frequency: 1, avg_quality_score: 28, avg_relevance_score: 33, examples: [], action: "expand" },
    ],
    top_hooks: [],
    quality_summary: { generator_ready: 0, needs_cleanup: 1, noise: 0, avg_relevance_score: 32 },
    generated_at: "2026-07-04T00:00:00.000Z",
  } as any, {
    platform: "instagram",
    ready: false,
    score: 21,
    videos: 18,
    analyzed: 4,
    patterns: 1,
    winners: 0,
    gates: { min_videos: 30, min_analyzed: 12, min_patterns: 4, min_winners: 2 },
    missing: ["videos", "patterns", "winners"],
  }, undefined, {
    platform: "instagram",
    total_posts: 3,
    winners: 0,
    losers: 2,
    avg_completion_rate: 0.16,
    avg_ctr: 0.004,
    total_orders: 0,
    total_revenue: 0,
    score: 18,
    confidence: "medium",
    status: "weak",
  });

  ok(trust.score < 50, "trust: thin brain scores low");
  eq(trust.status, "weak", "trust: thin brain is weak");
  eq(trust.confidence, "low", "trust: thin brain confidence low");
  ok(trust.why_not_yet.some((item) => item.includes("generator-ready")), "trust: explains why not ready");
  ok(trust.why_not_yet.some((item) => item.includes("market feedback")), "trust: outcome weakness surfaces in reasons");
}

{
  const nicheTrust = buildNicheTrustSummary({
    niche: "ru_cosmetics",
    meta_brain: {
      niche: "ru_cosmetics",
      platform: "all",
      total_videos: 80,
      analyzed_videos: 28,
      patterns: new Array(8).fill(null).map((_, index) => ({ pattern_id: `p${index}` })),
      generator_ready_patterns: new Array(3).fill(null).map((_, index) => ({ pattern_id: `r${index}` })),
      anti_patterns: [],
      top_hooks: [],
      quality_summary: { generator_ready: 3, needs_cleanup: 3, noise: 2, avg_relevance_score: 71 },
      generated_at: "2026-07-04T00:00:00.000Z",
    } as any,
    readiness: {
      platform: "tiktok",
      ready: true,
      score: 80,
      videos: 80,
      analyzed: 28,
      patterns: 8,
      winners: 3,
      gates: { min_videos: 40, min_analyzed: 16, min_patterns: 6, min_winners: 2 },
      missing: [],
    },
    platforms: [
      { platform: "tiktok", trust: { score: 88, status: "ready", confidence: "high", generator_ready_patterns: 2, total_patterns: 4, anti_patterns: 1, high_risk_anti_patterns: 0, medium_risk_anti_patterns: 1, avg_relevance_score: 74, ready_pattern_rate: 50, risk_pressure: 9, why_ready: [], why_not_yet: [], top_risks: [], note: "" } },
      { platform: "instagram", trust: { score: 54, status: "warming", confidence: "medium", generator_ready_patterns: 1, total_patterns: 3, anti_patterns: 1, high_risk_anti_patterns: 0, medium_risk_anti_patterns: 0, avg_relevance_score: 61, ready_pattern_rate: 33, risk_pressure: 4, why_ready: [], why_not_yet: [], top_risks: [], note: "" } },
      { platform: "youtube", trust: { score: 20, status: "weak", confidence: "low", generator_ready_patterns: 0, total_patterns: 0, anti_patterns: 0, high_risk_anti_patterns: 0, medium_risk_anti_patterns: 0, avg_relevance_score: 0, ready_pattern_rate: 0, risk_pressure: 0, why_ready: [], why_not_yet: [], top_risks: [], note: "" } },
    ],
  });

  eq(nicheTrust.strong_platforms, ["tiktok"], "niche trust: detects strong platform");
  eq(nicheTrust.weak_platforms, ["youtube"], "niche trust: detects weak platform");
}

console.log(`\nreelsBrainTrust: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
