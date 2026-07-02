import { deepEqual, equal } from "node:assert/strict";
import { buildReelsSeedMetadata, mergeAnalyzedFullWithReelsSeed } from "./reelsBrainCorpusUpsert";
import type { NormalizedReelsVideo } from "./reelsBrain";

const sampleVideo: NormalizedReelsVideo = {
  platform: "tiktok",
  url: "https://www.tiktok.com/@demo/video/123",
  canonicalUrl: "https://www.tiktok.com/@demo/video/123",
  mediaUrl: "https://v16m-default.tiktokcdn.com/demo.mp4",
  videoId: "123",
  caption: "Тестовый ролик #подарок",
  transcript: "Это тестовый транскрипт",
  author: "demo",
  views: 120000,
  likes: 9000,
  comments: 120,
  shares: 80,
  followers: 4000,
  durationSec: 19,
  publishedAt: "2026-07-01T12:00:00Z",
  hashtags: ["подарок", "ugc"],
  soundId: "sound-1",
  soundTitle: "Original sound",
};

{
  const seed = buildReelsSeedMetadata({
    video: sampleVideo,
    sourceProvider: "apify_tiktok",
    sourceQuery: "русский ugc подарок",
    sourceType: "provider",
    now: "2026-07-01T20:00:00Z",
  });
  equal(seed.source_provider, "apify_tiktok");
  equal(seed.media_locator_candidates[0], "https://v16m-default.tiktokcdn.com/demo.mp4");
  equal(seed.transcript, "Это тестовый транскрипт");
  deepEqual(seed.hashtags, ["подарок", "ugc"]);
}

{
  const seed = buildReelsSeedMetadata({
    video: sampleVideo,
    sourceProvider: "apify_tiktok",
    sourceQuery: "русский ugc подарок",
    sourceType: "provider",
    now: "2026-07-01T20:00:00Z",
  });
  const merged = mergeAnalyzedFullWithReelsSeed({
    ok: true,
    hook_text: "старый хук",
    reels_seed: {
      media_locator_candidates: ["https://old-cdn.example/video.mp4"],
      hashtags: ["ugc"],
      author: "existing-author",
    },
  }, seed) as Record<string, any>;

  equal(merged.ok, true);
  equal(merged.hook_text, "старый хук");
  equal(merged.reels_seed.author, "existing-author");
  deepEqual(merged.reels_seed.hashtags, ["ugc", "подарок"]);
  deepEqual(merged.reels_seed.media_locator_candidates, [
    "https://old-cdn.example/video.mp4",
    "https://v16m-default.tiktokcdn.com/demo.mp4",
  ]);
}

console.log("reelsBrainCorpusUpsert: passed");
