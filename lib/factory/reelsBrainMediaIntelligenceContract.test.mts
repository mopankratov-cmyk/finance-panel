import { equal } from "node:assert/strict";
import { classifyReelsMediaAsset } from "./reelsBrainMediaIntelligence";

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

console.log("reelsBrainMediaIntelligenceContract ok");
