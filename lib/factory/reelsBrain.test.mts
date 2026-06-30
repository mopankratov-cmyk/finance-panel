// Reels Brain corpus primitives. Run: npx tsx lib/factory/reelsBrain.test.mts
import {
  canonicalizeReelsUrl,
  inferPlatform,
  makeViralVideoRows,
  normalizeReelsVideo,
  scoreReelsVideo,
  toFiniteNumber,
} from "./reelsBrain";

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { fail++; console.error("✗", m); } }
function eq(a: unknown, b: unknown, m: string) { ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)})`); }

{
  eq(inferPlatform("https://www.tiktok.com/@a/video/123"), "tiktok", "inferPlatform: tiktok url");
  eq(inferPlatform("instagram"), "instagram", "inferPlatform: explicit instagram");
  eq(inferPlatform("https://youtu.be/abc"), "youtube", "inferPlatform: youtu.be");
  eq(inferPlatform("x"), "unknown", "inferPlatform: unknown");
}

{
  const yt = canonicalizeReelsUrl("https://www.youtube.com/watch?v=ABC123&utm_source=x");
  eq(yt, { canonicalUrl: "https://www.youtube.com/shorts/ABC123", videoId: "ABC123", platform: "youtube" }, "canonical: youtube watch → shorts");
  const tt = canonicalizeReelsUrl("https://www.tiktok.com/@shop/video/73123?utm_campaign=nope");
  eq(tt.videoId, "73123", "canonical: tiktok video id");
  ok(!tt.canonicalUrl.includes("utm_campaign"), "canonical: strips tracking params");
  const ig = canonicalizeReelsUrl("https://www.instagram.com/reel/CODE123/?igsh=abc");
  eq(ig, { canonicalUrl: "https://www.instagram.com/reel/CODE123/", videoId: "CODE123", platform: "instagram" }, "canonical: instagram reel");
}

{
  eq(toFiniteNumber("1.5k"), 1500, "number: k suffix");
  eq(toFiniteNumber("2,5 млн"), 2500000, "number: russian mln suffix");
  eq(toFiniteNumber("12 345"), 12345, "number: spaces");
  eq(toFiniteNumber("bad"), null, "number: bad → null");
}

{
  const video = normalizeReelsVideo({
    url: "https://www.instagram.com/reel/R1/",
    caption: "Первый хук #Beauty #sale",
    views: "100k",
    likes: "8k",
    comments_count: 250,
    shares: 100,
    author_followers: "5k",
    published_at: "2026-06-20T00:00:00Z",
    sound_title: "summer trend",
  });
  ok(!!video, "normalize: valid url accepted");
  eq(video?.platform, "instagram", "normalize: platform inferred");
  eq(video?.hashtags, ["beauty", "sale"], "normalize: hashtags from caption");
  eq(video?.views, 100000, "normalize: views parsed");
  const score = scoreReelsVideo(video!, Date.parse("2026-06-26T00:00:00Z"));
  ok(score.total > 35, "score: high-view outlier gets strong score");
  ok(score.outlier > 0, "score: outlier component present");
  eq(score.recency, 3, "score: recent boost");
}

{
  const prepared = makeViralVideoRows([
    { url: "https://www.tiktok.com/@a/video/1?utm_source=x" },
    { url: "https://www.tiktok.com/@a/video/1", views: 1000 },
    { url: "https://youtu.be/SHORT", caption: "x", views: 5000, likes: 500 },
    { caption: "no url" },
  ], { niche: "toys", sourceProvider: "manual", sourceQuery: "seed" });
  eq(prepared.rows.length, 2, "rows: dedups canonical urls and rejects no-url");
  eq(prepared.rejected, 1, "rows: rejected count");
  eq(prepared.rows[0].niche, "toys", "rows: niche set");
  eq(prepared.rows[0].source_orbit_id, "manual:q:seed", "rows: source marker set");
  eq(prepared.rows[1].platform, "youtube", "rows: youtube platform");
}

{
  const prepared = makeViralVideoRows([
    { url: "https://www.tiktok.com/@a/video/2", views: 1000 },
  ], { niche: "cosmetics", sourceProvider: "apify_tiktok", sourceQuery: "детские подарки" });
  eq(prepared.rows[0].source_orbit_id, "apify_tiktok:q:%D0%B4%D0%B5%D1%82%D1%81%D0%BA%D0%B8%D0%B5%20%D0%BF%D0%BE%D0%B4%D0%B0%D1%80%D0%BA%D0%B8", "rows: source query is url-encoded");
}

{
  const prepared = makeViralVideoRows([
    {
      url: "https://www.tiktok.com/@a/video/3",
      video_url: "https://cdn.example.com/signed-video-token",
      download_url: "https://cdn.example.com/video.mp4",
      audio_url: "https://cdn.example.com/audio.m4a",
      views: 1000,
    },
  ], { niche: "toys", sourceProvider: "apify_tiktok", sourceQuery: "игрушки" });
  eq(prepared.rows[0].video_url, "https://cdn.example.com/signed-video-token", "rows: persists provider video_url");
  eq(prepared.rows[0].download_url, "https://cdn.example.com/video.mp4", "rows: persists provider download_url");
  ok(!!prepared.rows[0].analyzed_full, "rows: stores compact media asset envelope");
}

console.log(`\nreelsBrain: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
