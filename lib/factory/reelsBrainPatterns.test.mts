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
      url: "u1",
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
      url: "u2",
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
      url: "u3",
      caption: "До и после уборки",
      format_detected: "before_after",
      virality_score: 20,
      views: 100000,
    },
  ], new Date("2026-06-26T00:00:00Z"));

  eq(memory.niche, "toys", "memory: niche");
  eq(memory.total_videos, 3, "memory: total");
  eq(memory.patterns[0].frequency, 2, "memory: merges similar warning demo pattern");
  eq(memory.patterns[0].hook_type, "warning_pattern_break", "memory: top hook type");
  eq(memory.patterns[0].sounds, ["summer"], "memory: sounds deduped");
  ok(memory.patterns[0].strength_score > memory.patterns[1].strength_score, "memory: stronger repeated pattern first");
  eq(memory.generated_at, "2026-06-26T00:00:00.000Z", "memory: deterministic timestamp");
}

console.log(`\nreelsBrainPatterns: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
