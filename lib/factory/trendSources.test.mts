// Trend source fallback helpers. Run: npx tsx lib/factory/trendSources.test.mts
import {
  availableTrendProviders,
  fallbackVirloAnalysis,
  hasUsableVirloAnalysis,
  prioritizeTrendProviders,
  preferredTrendProvider,
  trendSourceName,
} from "./trendSources";

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { fail++; console.error("✗", m); } }
function eq(a: unknown, b: unknown, m: string) { ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)})`); }

{
  ok(!hasUsableVirloAnalysis(null), "usable: null is false");
  ok(!hasUsableVirloAnalysis({}), "usable: empty object is false");
  ok(hasUsableVirloAnalysis({ hook_text: "Смотри сначала тест" }), "usable: hook makes analysis valid");
}

{
  const fallback = fallbackVirloAnalysis({
    url: "https://www.youtube.com/watch?v=abc",
    caption: "Не покупай этот бластер, пока не увидишь тест. Реально удивил по мощности.",
  });
  eq(fallback?.hook_text, "Не покупай этот бластер, пока не увидишь тест", "fallback: first sentence becomes hook");
  eq(fallback?.format_detected, "review", "fallback: review/test caption inferred");
  eq((fallback?.viral_reason as { source?: string } | null)?.source, "caption_fallback", "fallback: reason marks source");
}

{
  eq(fallbackVirloAnalysis({ caption: "" }), null, "fallback: empty caption returns null");
}

{
  const original = {
    APIFY_TOKEN: process.env.APIFY_TOKEN,
    APIFY_TIKTOK_ACTOR: process.env.APIFY_TIKTOK_ACTOR,
    APIFY_INSTAGRAM_REELS_ACTOR: process.env.APIFY_INSTAGRAM_REELS_ACTOR,
    APIFY_YOUTUBE_ACTOR: process.env.APIFY_YOUTUBE_ACTOR,
    VIRLO_API_KEY: process.env.VIRLO_API_KEY,
  };

  process.env.APIFY_TOKEN = "token";
  process.env.APIFY_TIKTOK_ACTOR = "actor/tiktok";
  process.env.APIFY_INSTAGRAM_REELS_ACTOR = "actor/instagram";
  process.env.APIFY_YOUTUBE_ACTOR = "actor/youtube";
  process.env.VIRLO_API_KEY = "virlo";

  eq(
    availableTrendProviders(),
    ["apify_tiktok", "apify_instagram", "apify_youtube", "virlo", "apify"],
    "providers: ordered by preferred source quality",
  );
  eq(preferredTrendProvider(), "apify_tiktok", "preferred: specialized Apify TikTok wins over generic source");
  eq(trendSourceName(), "apify_tiktok", "selected source name follows preferred provider");
  eq(
    prioritizeTrendProviders("instagram"),
    ["apify_instagram", "apify_tiktok", "apify_youtube", "virlo", "apify"],
    "providers: instagram prioritization puts exact provider first",
  );
  eq(
    prioritizeTrendProviders("youtube"),
    ["apify_youtube", "apify_tiktok", "apify_instagram", "virlo", "apify"],
    "providers: youtube prioritization puts exact provider first",
  );

  process.env.APIFY_TIKTOK_ACTOR = "";
  process.env.APIFY_INSTAGRAM_REELS_ACTOR = "";
  process.env.APIFY_YOUTUBE_ACTOR = "";
  eq(preferredTrendProvider(), "virlo", "preferred: Virlo wins when specialized Apify actors are unavailable");
  eq(trendSourceName(), "virlo", "selected source falls back to Virlo");

  for (const [key, value] of Object.entries(original)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log(`\ntrendSources: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
