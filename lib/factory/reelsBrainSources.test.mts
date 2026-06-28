// Reels Brain provider bake-off summary. Run: npx tsx lib/factory/reelsBrainSources.test.mts
import {
  availableReelsBrainProviders,
  hasReelsBrainProvider,
  pickBestBakeOffProvider,
  pickBestBakeOffProviderByPlatform,
  rankBakeOffProviders,
  summarizeProviderQuality,
} from "./reelsBrainSources";

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { fail++; console.error("✗", m); } }
function eq(a: unknown, b: unknown, m: string) { ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)})`); }

{
  const original = {
    APIFY_TOKEN: process.env.APIFY_TOKEN,
    APIFY_INSTAGRAM_REELS_ACTOR: process.env.APIFY_INSTAGRAM_REELS_ACTOR,
  };
  process.env.APIFY_TOKEN = "token";
  process.env.APIFY_INSTAGRAM_REELS_ACTOR = "";

  ok(hasReelsBrainProvider("apify_instagram"), "providers: reels brain enables apify_instagram through official actor fallback");
  ok(availableReelsBrainProviders().includes("apify_instagram"), "providers: reels brain registry includes apify_instagram fallback");

  for (const [key, value] of Object.entries(original)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
}

{
  const summary = summarizeProviderQuality("apify", "water gun", [
    {
      url: "https://www.tiktok.com/@a/video/1?utm_source=x",
      caption: "hook #toy",
      views: 100000,
      likes: 9000,
      comments: 300,
      shares: 120,
      followers: 4000,
      sound_title: "summer",
    },
    { url: "https://www.tiktok.com/@a/video/1", caption: "duplicate", views: 10 },
    { url: "https://youtu.be/S2", title: "short", views: 5000, likes: 400, comments: 20 },
    { caption: "no url" },
  ]);

  eq(summary.provider, "apify", "summary: provider kept");
  eq(summary.found, 4, "summary: found is raw count");
  eq(summary.valid, 2, "summary: valid excludes duplicate and no-url");
  eq(summary.duplicateCanonical, 1, "summary: canonical duplicate counted");
  eq(summary.withViews, 2, "summary: views coverage");
  eq(summary.withLikes, 2, "summary: likes coverage");
  eq(summary.withComments, 2, "summary: comments coverage");
  eq(summary.withFollowers, 1, "summary: followers coverage");
  eq(summary.withSound, 1, "summary: sound coverage");
  eq(summary.platforms.tiktok, 1, "summary: tiktok platform count");
  eq(summary.platforms.youtube, 1, "summary: youtube platform count");
  ok(summary.avgScore > 0, "summary: avg score computed");
  ok(summary.top[0].score >= summary.top[1].score, "summary: top sorted by score");
}

{
  const ranked = rankBakeOffProviders([
    {
      provider: "apify",
      configured: true,
      runs: 2,
      found: 20,
      valid: 10,
      valid_rate: 0.5,
      relevant: 8,
      relevance_rate: 0.4,
      avg_score: 12,
      with_followers: 6,
      with_sound: 3,
      avg_elapsed_ms: 4000,
      timeout_runs: 0,
      failed_runs: 0,
      cost_tier: "low",
    },
    {
      provider: "virlo",
      configured: true,
      runs: 2,
      found: 12,
      valid: 9,
      valid_rate: 0.75,
      relevant: 9,
      relevance_rate: 0.75,
      avg_score: 9,
      with_followers: 2,
      with_sound: 1,
      avg_elapsed_ms: 1200,
      timeout_runs: 0,
      failed_runs: 0,
      cost_tier: "high",
    },
    {
      provider: "youtube",
      configured: true,
      runs: 2,
      found: 30,
      valid: 0,
      valid_rate: 0,
      relevant: 0,
      relevance_rate: 0,
      avg_score: 0,
      with_followers: 0,
      with_sound: 0,
      avg_elapsed_ms: 800,
      timeout_runs: 0,
      failed_runs: 1,
      cost_tier: "low",
    },
  ]);

  eq(ranked[0].provider, "virlo", "ranking: higher relevance/validity wins");
  ok(ranked[0].rank_score > ranked[1].rank_score, "ranking: score desc");
  ok(ranked[0].rank_reason.includes("relevance"), "ranking: reason explains choice");
  eq(pickBestBakeOffProvider(ranked)?.provider, "virlo", "best: picks first usable ranked provider");
}

{
  const ranked = rankBakeOffProviders([
    {
      provider: "bright_tiktok",
      configured: true,
      runs: 2,
      found: 20,
      valid: 12,
      valid_rate: 0.6,
      relevant: 9,
      relevance_rate: 0.45,
      avg_score: 12,
      with_followers: 4,
      with_sound: 3,
      avg_elapsed_ms: 9500,
      timeout_runs: 1,
      failed_runs: 1,
      cost_tier: "high",
    },
    {
      provider: "apify_tiktok",
      configured: true,
      runs: 2,
      found: 19,
      valid: 11,
      valid_rate: 0.58,
      relevant: 9,
      relevance_rate: 0.47,
      avg_score: 11,
      with_followers: 4,
      with_sound: 3,
      avg_elapsed_ms: 1800,
      timeout_runs: 0,
      failed_runs: 0,
      cost_tier: "low",
    },
  ]);
  eq(ranked[0].provider, "apify_tiktok", "ranking: latency and cost can break close quality ties");
}

{
  eq(pickBestBakeOffProvider([
    {
      provider: "apify",
      configured: true,
      runs: 1,
      found: 10,
      valid: 0,
      valid_rate: 0,
      relevant: 0,
      relevance_rate: 0,
      avg_score: 0,
      with_followers: 0,
      with_sound: 0,
      avg_elapsed_ms: 0,
      timeout_runs: 0,
      failed_runs: 0,
      cost_tier: "low",
    },
  ]), null, "best: null when nobody returned usable results");
}

{
  const bestByPlatform = pickBestBakeOffProviderByPlatform([
    {
      provider: "apify_tiktok",
      platform: "tiktok",
      configured: true,
      runs: 2,
      found: 12,
      valid: 10,
      valid_rate: 0.83,
      relevant: 9,
      relevance_rate: 0.75,
      avg_score: 15,
      with_followers: 8,
      with_sound: 5,
      avg_elapsed_ms: 1500,
      timeout_runs: 0,
      failed_runs: 0,
      cost_tier: "low",
    },
    {
      provider: "virlo",
      platform: "tiktok",
      configured: true,
      runs: 2,
      found: 15,
      valid: 8,
      valid_rate: 0.53,
      relevant: 7,
      relevance_rate: 0.47,
      avg_score: 10,
      with_followers: 2,
      with_sound: 1,
      avg_elapsed_ms: 1300,
      timeout_runs: 0,
      failed_runs: 0,
      cost_tier: "high",
    },
    {
      provider: "apify_instagram",
      platform: "instagram",
      configured: true,
      runs: 2,
      found: 10,
      valid: 7,
      valid_rate: 0.7,
      relevant: 6,
      relevance_rate: 0.6,
      avg_score: 11,
      with_followers: 5,
      with_sound: 1,
      avg_elapsed_ms: 1700,
      timeout_runs: 0,
      failed_runs: 0,
      cost_tier: "low",
    },
  ]);

  eq(bestByPlatform.tiktok?.provider, "apify_tiktok", "best-by-platform: tiktok winner selected");
  eq(bestByPlatform.instagram?.provider, "apify_instagram", "best-by-platform: instagram winner selected");
  eq(bestByPlatform.youtube, null, "best-by-platform: null when platform has no usable rows");
}

console.log(`\nreelsBrainSources: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
