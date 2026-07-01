import { equal, ok } from "node:assert/strict";
import { buildReelsMediaIntelligenceReport, classifyReelsMediaAsset } from "./reelsBrainMediaIntelligence";

const row = classifyReelsMediaAsset({
  id: 1,
  url: "https://www.tiktok.com/@demo/video/123",
  platform: "tiktok",
  niche: "ru_toys",
  analyzed_full: {
    media_assets: {
      assets: [
        {
          field: "video_url",
          kind: "video",
          url: "https://example.com/reel.mp4",
        },
      ],
    },
  },
});

equal(row.status, "ready");
equal(row.reason, "direct_media_url");
equal(row.asset_kind, "video");
equal(row.asset_url, "https://example.com/reel.mp4");

const report = buildReelsMediaIntelligenceReport([
  {
    id: 2,
    url: "https://www.tiktok.com/@demo/video/456",
    platform: "tiktok",
    niche: "ru_toys",
    analyzed_full: {
      media_assets: {
        assets: [{ field: "video_url", kind: "video", url: "https://example.com/probed.mp4" }],
      },
      media_probe: {
        ok: true,
        duration_sec: 18.4,
        width: 720,
        height: 1280,
        has_audio: true,
        has_video: true,
        fps: 30,
        format: "mov,mp4,m4a,3gp,3g2,mj2",
        audio_features: {
          loudness_bucket: "balanced",
          sound_starts_immediately: true,
        },
        visual_features: {
          edit_pace: "fast",
          scene_change_count: 12,
        },
      },
    },
  },
  {
    id: 3,
    url: "https://www.tiktok.com/@demo/video/789",
    platform: "tiktok",
    niche: "ru_toys",
    analyzed_full: {
      media_assets: {
        assets: [{ field: "video_url", kind: "video", url: "https://example.com/unprobed.mp4" }],
      },
    },
  },
]);

equal(report.summary.media_probe_ok, 1);
equal(report.creative_dna_insights.probed_videos, 1);
equal(report.creative_dna_insights.unprobed_ready_videos, 1);
equal(report.creative_dna_insights.vertical_share_pct, 100);
equal(report.creative_dna_insights.audio_share_pct, 100);
equal(report.creative_dna_insights.feature_probed_videos, 1);
equal(report.creative_dna_insights.feature_backlog_videos, 0);
equal(report.creative_dna_insights.immediate_sound_share_pct, 100);
equal(report.creative_dna_insights.fast_edit_share_pct, 100);
equal(report.creative_dna_insights.duration_buckets.short, 1);
equal(report.creative_dna_insights.loudness_buckets.balanced, 1);
equal(report.creative_dna_insights.edit_pace_buckets.fast, 1);
ok(report.creative_dna_insights.next_actions.some((action) => action.includes("Догнать AV-probe")));

console.log("reelsBrainMediaIntelligenceContract ok");
