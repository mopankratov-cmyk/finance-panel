import { strict as assert } from "node:assert";
import {
  buildViewingIntelligenceReport,
  scoreViewingCandidate,
} from "./reelsBrainViewingIntelligence";

{
  const candidate = scoreViewingCandidate({
    id: 1,
    url: "https://www.tiktok.com/@small/video/1",
    platform: "tiktok",
    niche: "ru_toys",
    caption: "Шок, эта развивающая игрушка заняла ребенка на час. Обзор и тест.",
    hook_text: "Я не ожидала, что ребенок залипнет",
    views: 180000,
    likes: 12000,
    followers_creator: 2200,
    virality_score: 48,
    source_orbit_id: "apify_tiktok:развивающие игрушки",
    created_at: new Date().toISOString(),
    analyzed: true,
  });

  assert.equal(candidate.priority, "high");
  assert.equal(candidate.next_action, "resolve_mp4");
  assert.ok(candidate.scores.relevance >= 60);
  assert.ok(candidate.scores.breakout >= 50);
  assert.ok(candidate.scores.small_account >= 60);
  assert.ok(candidate.reasons.includes("small_account_breakout"));
  assert.ok(candidate.creative_brief.do_not_copy.includes("exact footage"));
}

{
  const candidate = scoreViewingCandidate({
    id: 2,
    url: "https://www.tiktok.com/@weak/video/2",
    platform: "tiktok",
    niche: "ru_cosmetics",
    caption: "привет ребята подпишись",
    views: 0,
    followers_creator: 400000,
    virality_score: 2,
  });

  assert.ok(candidate.priority === "low" || candidate.next_action === "skip");
  assert.ok(candidate.anti_patterns.includes("generic_intro_or_cta"));
  assert.ok(candidate.anti_patterns.includes("missing_views"));
}

{
  const report = buildViewingIntelligenceReport([
    {
      id: 3,
      url: "https://www.tiktok.com/@a/video/3",
      platform: "tiktok",
      niche: "ru_clothing",
      caption: "Примерка платья: до и после, какой образ выбрать",
      views: 90000,
      followers_creator: 1800,
      virality_score: 42,
      source_orbit_id: "apify_tiktok:примерка одежды",
      analyzed_full: {
        media_assets: {
          assets: [{ kind: "video", field: "video_url", url: "https://example.com/3.mp4" }],
        },
      },
    },
    {
      id: 4,
      url: "https://www.tiktok.com/@b/video/4",
      platform: "tiktok",
      niche: "ru_clothing",
      caption: "Примерка костюма и честный обзор размера",
      views: 70000,
      followers_creator: 2600,
      virality_score: 36,
      source_orbit_id: "apify_tiktok:примерка одежды",
    },
  ]);

  assert.equal(report.ok, true);
  assert.equal(report.summary.total, 2);
  assert.ok(report.summary.analyze_media + report.summary.build_brief + report.summary.resolve_mp4 >= 1);
  assert.equal(report.source_quality.best_sources[0].source, "apify_tiktok:примерка одежды");
  assert.ok(report.operating_rules.some((rule) => rule.includes("small-account")));
}

console.log("reelsBrainViewingIntelligence: ok");
