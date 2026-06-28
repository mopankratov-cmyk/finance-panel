// Reels Brain discovery intelligence. Run: npx tsx lib/factory/reelsBrainDiscovery.test.mts
import { strict as assert } from "node:assert";
import {
  buildDiscoveryReplay,
  buildDiscoveryPlan,
  discoverySources,
  rememberDiscoverySourceRun,
  scoreDiscoveryCandidate,
} from "./reelsBrainDiscovery";

{
  const score = scoreDiscoveryCandidate("обзор косметики", {
    url: "https://www.tiktok.com/@small/video/1",
    platform: "tiktok",
    caption: "Обзор косметики: до и после тонального крема",
    views: 120000,
    followers: 1800,
    likes: 9000,
  });

  assert.equal(score.relevant, true);
  assert.ok(score.breakout_score >= 45);
  assert.ok(score.small_account_score >= 50);
  assert.ok(score.reasons.includes("small_account_signal"));
}

{
  const playbook = rememberDiscoverySourceRun({ niche: "ru_cosmetics" }, {
    niche: "ru_cosmetics",
    platform: "tiktok",
    type: "query",
    value: "обзор косметики",
    found: 100,
    relevant: 42,
    breakout: 18,
    inserted: 30,
    cost_units: 4,
    checked_at: "2026-06-28T00:00:00.000Z",
  });
  const sources = discoverySources(playbook, { niche: "ru_cosmetics", platform: "tiktok" });

  assert.equal(sources.length, 1);
  assert.equal(sources[0].status, "active");
  assert.ok(sources[0].yield_score > 50);
  assert.equal(sources[0].relevance_rate, 0.42);
  assert.equal(sources[0].breakout_rate, 0.429);
}

{
  const replay = buildDiscoveryReplay({
    niche: "ru_cosmetics",
    platform: "tiktok",
    rows: [
      {
        url: "https://www.tiktok.com/@a/video/1",
        platform: "tiktok",
        niche: "ru_cosmetics",
        caption: "Обзор косметики и тест крема до после",
        views: 180000,
        likes: 12000,
        followers_creator: 2400,
        sound_title: "beauty sound",
        source_orbit_id: "apify_tiktok:обзор косметики",
      },
      {
        url: "https://www.tiktok.com/@b/video/2",
        platform: "tiktok",
        niche: "ru_cosmetics",
        caption: "Тест косметики на коже",
        views: 90000,
        likes: 5000,
        followers_creator: 1800,
        sound_title: "beauty sound",
        source_orbit_id: "apify_tiktok:обзор косметики",
      },
      {
        url: "https://www.tiktok.com/@c/video/3",
        platform: "tiktok",
        niche: "ru_cosmetics",
        caption: "авто новости",
        views: 50000,
        likes: 1000,
        followers_creator: 70000,
        source_orbit_id: "apify_tiktok:обзор косметики",
      },
    ],
  });

  assert.equal(replay.scanned, 3);
  assert.ok(replay.relevant >= 2);
  assert.ok(replay.breakout >= 2);
  assert.equal(replay.sources[0].value, "обзор косметики");
  assert.equal(replay.sources[0].provider, "apify_tiktok");
  assert.equal(replay.sound_sources[0].value, "beauty sound");
}

{
  let playbook: Record<string, unknown> = { niche: "ru_toys" };
  playbook = rememberDiscoverySourceRun(playbook, {
    niche: "ru_toys",
    platform: "youtube",
    type: "account",
    value: "@toy-small",
    found: 20,
    relevant: 16,
    breakout: 9,
    inserted: 12,
    cost_units: 2,
  });
  const plan = buildDiscoveryPlan(playbook, {
    niche: "ru_toys",
    platform: "youtube",
    max_items: 3,
    source_limit: 15,
  });

  assert.equal(plan.platform, "youtube");
  assert.ok(plan.items.length >= 1);
  assert.equal(plan.items[0].source.type, "account");
  assert.equal(plan.items[0].source_run_payload.discovery_source_type, "account");
  assert.equal(plan.items[0].source_run_payload.limit, 15);
}

console.log("reelsBrainDiscovery: ok");
