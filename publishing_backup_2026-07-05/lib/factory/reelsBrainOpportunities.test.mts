import assert from "node:assert/strict";
import { buildReelsBrainOpportunities } from "./reelsBrainOpportunities";

function testBuildReelsBrainOpportunitiesRanksBestSegments() {
  const result = buildReelsBrainOpportunities({
    nicheSummaries: [
      {
        niche: "ru_toys",
        platform_brains: {
          tiktok: { total_videos: 120, analyzed_videos: 95, patterns: 8, generator_ready_patterns: 5 },
          instagram: { total_videos: 70, analyzed_videos: 55, patterns: 6, generator_ready_patterns: 3 },
        },
      },
      {
        niche: "ru_cosmetics",
        platform_brains: {
          instagram: { total_videos: 80, analyzed_videos: 35, patterns: 5, generator_ready_patterns: 2 },
          youtube: { total_videos: 25, analyzed_videos: 8, patterns: 1, generator_ready_patterns: 0 },
        },
      },
    ],
    segmentTrust: {
      by_niche: [
        { niche: "ru_toys", score: 81, status: "ready", confidence: "high", note: "strong" },
        { niche: "ru_cosmetics", score: 38, status: "weak", confidence: "low", note: "weak" },
      ],
      by_platform: [
        { platform: "tiktok", score: 59, status: "warming", confidence: "medium", note: "warming" },
        { platform: "instagram", score: 56, status: "warming", confidence: "medium", note: "warming" },
        { platform: "youtube", score: 32, status: "weak", confidence: "low", note: "weak" },
      ],
    },
    briefPackGroups: {
      by_niche: [{ niche: "ru_toys", primary: { title: "Toys brief", creative_brief: { hook: "Смотри" } } }],
      by_platform: [{ platform: "tiktok", primary: { title: "TikTok brief", creative_brief: { hook: "Смотри" } } }],
    },
    actionPackGroups: {
      by_niche: [{ niche: "ru_toys", primary: { title: "Toys action" } }],
      by_platform: [{ platform: "tiktok", primary: { title: "TikTok action" } }],
    },
    hypothesisBankGroups: {
      by_niche: [{ niche: "ru_toys", primary: { title: "Toys hypothesis", hypothesis: "test toys" } }],
      by_platform: [{ platform: "tiktok", primary: { title: "TikTok hypothesis", hypothesis: "test tiktok" } }],
    },
    segmentOutputBanks: {
      briefs: [{ niche: "ru_toys", platform: "tiktok", primary: {
        title: "Exact TikTok brief",
        creative_brief: { hook: "Точный сегментный hook" },
        trust: {
          trust_band: "high_trust",
          evidence_band: "exact",
          proof_quality: "exact_segment",
          high_trust_generation_ready: true,
          publishable_exact: true,
          policy_reason: "exact proof already closed",
        },
      } }],
      actions: [{ niche: "ru_toys", platform: "tiktok", primary: { title: "Exact TikTok action", decision: "scale" } }],
      hypotheses: [{ niche: "ru_toys", platform: "tiktok", cards: [{ title: "Exact TikTok hypothesis", hypothesis: "test exact tiktok" }] }],
    },
    segmentReadiness: [
      { niche: "ru_toys", platform: "tiktok", total_backlog: 0, dominant_gap: { key: "analyze", count: 0 }, direct_rate: 90, audio_rate: 82, transcript_ready_rate: 76, analyzed_rate: 79 },
      { niche: "ru_toys", platform: "instagram", total_backlog: 14, dominant_gap: { key: "transcript", count: 9 }, direct_rate: 72, audio_rate: 24, transcript_ready_rate: 16, analyzed_rate: 65 },
      { niche: "ru_cosmetics", platform: "instagram", total_backlog: 11, dominant_gap: { key: "audio", count: 8 }, direct_rate: 68, audio_rate: 22, transcript_ready_rate: 14, analyzed_rate: 44 },
      { niche: "ru_cosmetics", platform: "youtube", total_backlog: 18, dominant_gap: { key: "media", count: 10 }, direct_rate: 18, audio_rate: 6, transcript_ready_rate: 4, analyzed_rate: 32 },
    ],
    limit: 6,
  });

  assert.equal(result.summary.total, 4);
  assert.equal(result.top[0]?.niche, "ru_toys");
  assert.equal(result.top[0]?.platform, "tiktok");
  assert.equal(result.top[0]?.recommended_mode, "control_only");
  assert.equal(result.top[0]?.best_brief_title, "Exact TikTok brief");
  assert.equal(result.top[0]?.best_action_title, "Exact TikTok action");
  assert.equal(result.top[0]?.best_hypothesis, "test exact tiktok");
  assert.equal(result.top[0]?.proof_quality, "exact_segment");
  assert.equal(result.top[0]?.publishable_exact, true);
  assert.equal(result.top[0]?.high_trust_generation_ready, true);
  assert.equal(result.top[0]?.trust_band, "high_trust");
  assert.equal(result.top[0]?.foundation_status, "ready");
  assert.match(String(result.top[0]?.policy_reason), /exact proof/i);
  assert.equal(result.top.find((row) => row.niche === "ru_toys" && row.platform === "instagram")?.recommended_mode, "research_only");
  assert.equal(result.summary.exact_proof_ready, 1);
  assert.equal(result.summary.generation_ready, 1);
  assert.equal(result.top.at(-1)?.platform, "youtube");
}

function run() {
  testBuildReelsBrainOpportunitiesRanksBestSegments();
  console.log("reelsBrainOpportunities.test: ok");
}

run();
