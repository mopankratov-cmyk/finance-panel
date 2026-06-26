// Reels Brain provider bake-off summary. Run: npx tsx lib/factory/reelsBrainSources.test.mts
import { summarizeProviderQuality } from "./reelsBrainSources";

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { fail++; console.error("✗", m); } }
function eq(a: unknown, b: unknown, m: string) { ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)})`); }

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

console.log(`\nreelsBrainSources: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
