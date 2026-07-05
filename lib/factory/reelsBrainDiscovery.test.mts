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
    segment_outcome_status: "promising",
    segment_outcome_confidence: "medium",
    checked_at: "2026-06-28T00:00:00.000Z",
  });
  const sources = discoverySources(playbook, { niche: "ru_cosmetics", platform: "tiktok" });

  assert.equal(sources.length, 1);
  assert.equal(sources[0].status, "active");
  assert.ok(sources[0].yield_score > 50);
  assert.equal(sources[0].relevance_rate, 0.42);
  assert.equal(sources[0].breakout_rate, 0.429);
  assert.equal(sources[0].segment_outcome_status, "promising");
  assert.equal(sources[0].segment_outcome_confidence, "medium");
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
  const replay = buildDiscoveryReplay({
    niche: "ru_toys",
    platform: "tiktok",
    rows: [
      {
        url: "https://www.tiktok.com/@a/video/4",
        platform: "tiktok",
        niche: "ru_toys",
        caption: "Детские подарки и развивающие игрушки",
        views: 120000,
        likes: 7000,
        followers_creator: 1900,
        source_orbit_id: "apify_tiktok:q:%D0%B4%D0%B5%D1%82%D1%81%D0%BA%D0%B8%D0%B5%20%D0%BF%D0%BE%D0%B4%D0%B0%D1%80%D0%BA%D0%B8",
      },
      {
        url: "https://www.tiktok.com/@b/video/5",
        platform: "tiktok",
        niche: "ru_toys",
        caption: "Детские подарки и игрушки на маркетплейсе",
        views: 90000,
        likes: 5000,
        followers_creator: 1600,
        source_orbit_id: "apify_tiktok:РґРµС‚СЃРєРёРµ РїРѕРґР°СЂРєРё",
      },
    ],
  });

  assert.equal(replay.sources.length, 1);
  assert.equal(replay.sources[0].value, "детские подарки");
  assert.equal(replay.sources[0].found, 2);
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

{
  let playbook: Record<string, unknown> = {
    niche: "ru_cosmetics",
    feedback_loop: {
      segment_outcome_memory: {
        weak_segments: [
          {
            niche: "ru_cosmetics",
            platform: "instagram",
            status: "weak",
            posts: 4,
            winners: 0,
          },
        ],
      },
    },
  };
  playbook = rememberDiscoverySourceRun(playbook, {
    niche: "ru_cosmetics",
    platform: "instagram",
    type: "query",
    value: "косметика обзор",
    found: 80,
    relevant: 32,
    breakout: 10,
    inserted: 20,
    cost_units: 3,
  });
  playbook = rememberDiscoverySourceRun(playbook, {
    niche: "ru_cosmetics",
    platform: "instagram",
    type: "account",
    value: "@beauty_lab",
    found: 40,
    relevant: 20,
    breakout: 7,
    inserted: 12,
    cost_units: 2,
  });
  const plan = buildDiscoveryPlan(playbook, {
    niche: "ru_cosmetics",
    platform: "instagram",
    max_items: 4,
    source_limit: 15,
  });

  assert.equal(plan.outcome_status, "weak");
  assert.equal(plan.proof_quality, "untraced");
  assert.equal(plan.trust_action, "wait_for_feedback");
  assert.deepEqual(plan.budget_split, { explore: 55, exploit: 10, refresh: 35 });
  assert.ok(plan.notes.some((note) => note.includes("weak")));
}

{
  let playbook: Record<string, unknown> = {
    niche: "ru_toys",
    feedback_loop: {
      segment_outcome_memory: {
        strongest_segments: [
          {
            niche: "ru_toys",
            platform: "tiktok",
            status: "proven",
            posts: 6,
            winners: 3,
          },
        ],
      },
    },
  };
  playbook = rememberDiscoverySourceRun(playbook, {
    niche: "ru_toys",
    platform: "tiktok",
    type: "query",
    value: "игрушки обзор",
    found: 120,
    relevant: 60,
    breakout: 30,
    inserted: 44,
    cost_units: 4,
  });
  const plan = buildDiscoveryPlan(playbook, {
    niche: "ru_toys",
    platform: "tiktok",
    max_items: 4,
  });

  assert.equal(plan.outcome_status, "proven");
  assert.equal(plan.outcome_confidence, "high");
  assert.equal(plan.proof_quality, "untraced");
  assert.deepEqual(plan.budget_split, { explore: 25, exploit: 30, refresh: 45 });
}

{
  let playbook: Record<string, unknown> = {
    niche: "ru_clothing",
    feedback_loop: {
      by_segment: [
        {
          niche: "ru_clothing",
          platform: "instagram",
          status: "proven",
          proof_quality: "traced_transfer_only",
          posts: 4,
          winners: 2,
        },
      ],
      segment_outcome_memory: {
        trust_update_queue: [
          {
            segment: "ru_clothing × instagram",
            trust_action: "keep_validating_segment",
            evidence: "2 winners / 4 posts · exact 0",
          },
        ],
      },
    },
  };
  playbook = rememberDiscoverySourceRun(playbook, {
    niche: "ru_clothing",
    platform: "instagram",
    type: "query",
    value: "обзор одежды",
    found: 90,
    relevant: 40,
    breakout: 14,
    inserted: 25,
    cost_units: 3,
  });
  playbook = rememberDiscoverySourceRun(playbook, {
    niche: "ru_clothing",
    platform: "instagram",
    type: "account",
    value: "@style_lab",
    found: 50,
    relevant: 26,
    breakout: 9,
    inserted: 16,
    cost_units: 2,
  });
  const plan = buildDiscoveryPlan(playbook, {
    niche: "ru_clothing",
    platform: "instagram",
    max_items: 4,
  });

  assert.equal(plan.outcome_status, "proven");
  assert.equal(plan.proof_quality, "traced_transfer_only");
  assert.equal(plan.trust_action, "keep_validating_segment");
  assert.deepEqual(plan.budget_split, { explore: 25, exploit: 30, refresh: 45 });
  assert.ok(plan.notes.some((note) => note.includes("transfer")));
}

console.log("reelsBrainDiscovery: ok");
