import assert from "node:assert/strict";
import { buildReelsBrainEvidenceLedger } from "./reelsBrainEvidenceLedger";

function testBuildReelsBrainEvidenceLedgerSeparatesCorpusAndMarketTrust() {
  const result = buildReelsBrainEvidenceLedger({
    segmentPlaybook: {
      items: [
        {
          niche: "ru_toys",
          platform: "tiktok",
          recommended_mode: "primary",
          opportunity_score: 92,
          stability_score: 88,
          stable_pattern_count: 4,
          coverage_rate: 82,
          brief: { title: "Toys TT brief", hook: "Смотри что внутри" },
          hypothesis: { title: "Reveal hypothesis", text: "Reveal lifts hold" },
          rollout: { title: "Scale toys", why_now: "strong", next_step: "publish" },
          leading_pattern: { title: "Fast demo", hook: "Смотри что внутри", retention: "payoff", format: "demo", market_status: "proven" },
        },
        {
          niche: "ru_cosmetics",
          platform: "instagram",
          recommended_mode: "control_only",
          opportunity_score: 78,
          stability_score: 74,
          stable_pattern_count: 2,
          coverage_rate: 61,
          brief: { title: "Beauty IG brief", hook: "До и после" },
          rollout: { title: "Validate beauty", why_now: "good corpus", next_step: "control test" },
          leading_pattern: { title: "Proof before after", hook: "До и после", retention: "proof", format: "ugc", market_status: "no_feedback" },
        },
      ],
    },
    limit: 6,
  });

  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.high_trust, 1);
  assert.equal(result.summary.corpus_strong_market_thin, 1);
  assert.equal(result.items[0]?.evidence_status, "high_trust");
  assert.equal(result.items[0]?.market_status, "proven");
  assert.equal(result.items[1]?.evidence_status, "corpus_strong_market_thin");
  assert.equal(result.items[1]?.market_status, "no_feedback");
}

function run() {
  testBuildReelsBrainEvidenceLedgerSeparatesCorpusAndMarketTrust();
  console.log("reelsBrainEvidenceLedger.test: ok");
}

run();
