// Reels Brain pattern memory. Run: npx tsx lib/factory/reelsBrainPatterns.test.mts
import { buildReelsPatternMemory, inferHookType } from "./reelsBrainPatterns";

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { fail++; console.error("✗", m); } }
function eq(a: unknown, b: unknown, m: string) { ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)})`); }

{
  eq(inferHookType("Не покупай это пока не увидишь тест"), "warning_pattern_break", "hook: warning");
  eq(inferHookType("Почему этот крем стал вирусным?"), "curiosity_question", "hook: question");
  eq(inferHookType("5 причин взять с собой"), "list_promise", "hook: list");
  eq(inferHookType("Распаковка находки"), "demo_review", "hook: demo");
}

{
  const memory = buildReelsPatternMemory("toys", [
    {
      id: 1,
      url: "https://www.tiktok.com/@toy/video/1",
      platform: "tiktok",
      caption: "Не покупай водный пистолет пока не увидишь тест",
      hook_text: "Не покупай водный пистолет пока не увидишь тест",
      format_detected: "demo",
      viral_reason: { why: "proof and curiosity" },
      virality_score: 41,
      views: 900000,
      sound_title: "summer",
    },
    {
      id: 2,
      url: "https://www.tiktok.com/@toy/video/2",
      platform: "tiktok",
      caption: "Не покупай бластер пока не увидишь тест",
      hook_text: "Не покупай бластер пока не увидишь тест",
      format_detected: "demo",
      viral_reason: { why: "proof" },
      virality_score: 32,
      views: 400000,
      sound_title: "summer",
    },
    {
      id: 3,
      url: "https://www.instagram.com/reel/CLEAN123/",
      platform: "instagram",
      caption: "До и после уборки",
      format_detected: "before_after",
      virality_score: 20,
      views: 100000,
    },
  ], new Date("2026-06-26T00:00:00Z"));

  eq(memory.niche, "toys", "memory: niche");
  eq(memory.platform, "all", "memory: top-level bundle uses meta scope");
  eq(memory.total_videos, 3, "memory: total");
  eq(memory.patterns[0].frequency, 2, "memory: merges similar warning demo pattern");
  eq(memory.patterns[0].hook_type, "warning_pattern_break", "memory: top hook type");
  eq(memory.patterns[0].hook_label, "предупреждение / слом ожидания", "memory: Russian hook label");
  eq(memory.patterns[0].structure_label, "демонстрация", "memory: Russian structure label");
  eq(memory.patterns[0].retention_label, "ожидание доказательства", "memory: Russian retention label");
  eq(memory.patterns[0].sounds, ["summer"], "memory: sounds deduped");
  eq(memory.patterns[0].quality_label, "generator_ready", "memory: repeated relevant RU pattern is generator-ready");
  eq(memory.generator_ready_patterns[0]?.pattern_id, memory.patterns[0].pattern_id, "memory: exposes safe generator-ready bank");
  ok(memory.quality_summary.generator_ready >= 1, "memory: quality summary counts ready patterns");
  ok(memory.patterns[0].strength_score > memory.patterns[1].strength_score, "memory: stronger repeated pattern first");
  eq(memory.meta_brain.platform, "all", "memory: meta brain present");
  eq(memory.platform_brains.tiktok?.platform, "tiktok", "memory: tiktok brain built");
  eq(memory.platform_brains.instagram?.platform, "instagram", "memory: instagram brain built");
  eq(memory.generated_at, "2026-06-26T00:00:00.000Z", "memory: deterministic timestamp");
}

{
  const memory = buildReelsPatternMemory("ru_cosmetics", [
    {
      id: 1,
      platform: "tiktok",
      caption: "котик",
      hook_text: "котик",
      virality_score: 99,
      views: 1000000,
    },
    {
      id: 2,
      platform: "tiktok",
      caption: "До и после: тест тонального крема на коже",
      hook_text: "До и после: тест тонального крема на коже",
      format_detected: "before_after",
      viral_reason: { why: "proof transformation" },
      virality_score: 45,
      views: 500000,
    },
    {
      id: 3,
      platform: "instagram",
      caption: "До и после: тест тонального крема на коже",
      hook_text: "До и после: тест тонального крема на коже",
      format_detected: "before_after",
      viral_reason: { why: "proof transformation" },
      virality_score: 42,
      views: 300000,
    },
  ], new Date("2026-06-26T00:00:00Z"));

  const noisy = memory.patterns.find((pattern) => pattern.hooks.includes("котик"));
  eq(noisy?.quality_label, "noise", "quality: short off-niche singleton is noise");
  ok(memory.generator_ready_patterns.some((pattern) => pattern.structure_type === "before_after"), "quality: repeated RU cosmetics proof pattern is generator-ready");
  ok(memory.top_hooks.every((hook) => hook !== "котик"), "quality: top hooks prefer generator-ready bank");
}

{
  const memory = buildReelsPatternMemory("gadgets", [
    {
      id: 1,
      url: "https://www.tiktok.com/@x/video/1",
      platform: "tiktok",
      caption: "Не покупай это пока не увидишь тест",
      hook_text: "Не покупай это пока не увидишь тест",
      format_detected: "demo",
      viral_reason: { why: "proof" },
      virality_score: 40,
      views: 800000,
    },
    {
      id: 2,
      url: "https://www.instagram.com/reel/ABC123/",
      platform: "instagram",
      caption: "Не покупай это пока не увидишь тест",
      hook_text: "Не покупай это пока не увидишь тест",
      format_detected: "demo",
      viral_reason: { why: "proof" },
      virality_score: 36,
      views: 300000,
    },
  ], new Date("2026-06-26T00:00:00Z"));

  eq(memory.cross_platform_patterns[0]?.platform_count, 2, "cross-platform: detects shared pattern");
  eq(memory.cross_platform_patterns[0]?.platforms, ["instagram", "tiktok"], "cross-platform: preserves participating platforms");
}

{
  const memory = buildReelsPatternMemory("ru_bags", [
    {
      id: 1,
      platform: "instagram",
      caption: "Смотри до конца",
      analyzed_full: {
        hook_type_v2: "warning_pattern_break",
        structure_v2: "review",
      },
      virality_score: 31,
      views: 220000,
      sound_title: "soft beat",
    },
    {
      id: 2,
      platform: "tiktok",
      caption: "Смотри до конца",
      analyzed_full: {
        hook_type_v2: "warning_pattern_break",
        structure_v2: "review",
      },
      virality_score: 29,
      views: 180000,
      sound_title: "soft beat",
    },
  ], new Date("2026-06-26T00:00:00Z"), {
    playbook: {
      reels_brain_taxonomy: {
        relevance_terms_by_niche: {
          ru_bags: ["сумк", "рюкзак", "шоппер"],
        },
      },
    },
  });

  eq(memory.patterns[0]?.hook_type, "warning_pattern_break", "memory: explicit analyzed_full hook type wins over regex fallback");
  eq(memory.patterns[0]?.structure_type, "review", "memory: explicit analyzed_full structure wins over caption fallback");
  ok(!memory.patterns[0]?.quality_reasons.includes("unknown_niche_taxonomy"), "memory: playbook taxonomy removes unknown niche penalty");
}

console.log(`\nreelsBrainPatterns: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
