import { deepEqual, equal } from "node:assert/strict";
import { buildReelsSeedMetadata, mergeAnalyzedFullWithReelsSeed, mergeAnalyzedFullWithAudioExtraction } from "./reelsBrainCorpusUpsert";
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
  equal(seed.pipeline.media_status, "media_found");
  equal(seed.pipeline.transcript_status, "transcript_ready");
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
  equal(merged.reels_seed.pipeline.media_status, "media_found");
}

{
  const merged = mergeAnalyzedFullWithAudioExtraction({
    reels_seed: {
      media_locator_candidates: ["https://old-cdn.example/video.mp4"],
      pipeline: {
        media_status: "media_found",
        audio_status: "audio_pending",
        transcript_status: "transcript_pending",
        attempts: { media: 1, audio: 0, transcript: 0 },
      },
    },
  }, {
    mediaUrl: "https://old-cdn.example/video.mp4",
    mediaStatus: "media_downloaded",
    audioStatus: "audio_extracted",
    transcriptStatus: "transcript_ready",
    transcript: "новая расшифровка",
    audioFeatures: { sample_rate_hz: 44100, channels: 2, mean_volume_db: -14.2 },
    error: null,
    now: "2026-07-02T09:00:00Z",
  }) as Record<string, any>;

  equal(merged.reels_seed.pipeline.media_status, "media_downloaded");
  equal(merged.reels_seed.pipeline.audio_status, "audio_extracted");
  equal(merged.reels_seed.pipeline.transcript_status, "transcript_ready");
  equal(merged.reels_seed.transcript, "новая расшифровка");
  equal(merged.reels_seed.audio_features.sample_rate_hz, 44100);
  equal(merged.reels_seed.pipeline.attempts.audio, 1);
  equal(merged.reels_seed.pipeline.attempts.transcript, 1);
}

{
  const seed = buildReelsSeedMetadata({
    sourceProvider: "apify_youtube",
    sourceQuery: "ru cosmetics shorts",
    sourceType: "provider",
    video: {
      url: "https://www.youtube.com/shorts/ABC123XYZ99",
      canonicalUrl: "https://www.youtube.com/shorts/ABC123XYZ99",
      platform: "youtube",
      videoId: "ABC123XYZ99",
      caption: "demo",
      transcript: null,
      author: null,
      durationSec: 12,
      hashtags: [],
      mediaUrl: null,
      soundId: null,
      soundTitle: null,
      publishedAt: null,
      views: 1000,
      likes: 10,
      comments: 1,
      shares: 0,
      followers: 0,
    },
  });
  equal(seed.media_locator_candidates[0], "https://www.youtube.com/shorts/ABC123XYZ99");
  equal(seed.pipeline.media_status, "media_found");
}

{
  const seed = buildReelsSeedMetadata({
    sourceProvider: "apify_instagram",
    sourceQuery: "обзор косметики",
    sourceType: "provider",
    video: {
      url: "https://www.instagram.com/reel/CRU123ABC99/",
      canonicalUrl: "https://www.instagram.com/reel/CRU123ABC99/",
      platform: "instagram",
      videoId: "CRU123ABC99",
      caption: "demo",
      transcript: null,
      author: null,
      durationSec: 18,
      hashtags: [],
      mediaUrl: null,
      soundId: null,
      soundTitle: null,
      publishedAt: null,
      views: 1000,
      likes: 10,
      comments: 1,
      shares: 0,
      followers: 0,
    },
  });
  equal(seed.media_locator_candidates[0], "https://www.instagram.com/reel/CRU123ABC99/");
  equal(seed.pipeline.media_status, "media_found");
}

console.log("reelsBrainCorpusUpsert: passed");
