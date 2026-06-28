import { learningHints, winnersHintFor, corpusHooksFor, rejectAntiFor } from "./learningHints";

let passed = 0;
let failed = 0;

function ok(cond: boolean, msg: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", msg);
  }
}

function chain(data: unknown[] | null, shouldThrow = false): unknown {
  const q: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "not"]) {
    q[method] = () => {
      if (shouldThrow) throw new Error("db unavailable");
      return q;
    };
  }
  q.then = (resolve: (value: unknown) => void) => resolve({ data });
  return q;
}

function fakeDb(tables: Record<string, unknown[] | null>, shouldThrow = false): any {
  return {
    from(name: string) {
      if (shouldThrow) throw new Error("db unavailable");
      return chain(tables[name] || [], false);
    },
  };
}

const veryLong = "очень ".repeat(80);
const db = fakeDb({
  content_assets: [{ winner_learnings: { hook: veryLong }, name: veryLong }],
  viral_hooks: [{ hook_text: veryLong }, { hook_text: "короткий хук" }],
  cf_signals: [{ reason_chip: veryLong }, { reason_chip: veryLong }, { reason_chip: "скучно" }],
});

const hint = await learningHints(db, "bags");
ok(hint.includes("НАШИ ПОБЕДИТЕЛИ"), "combined hints include winners section");
ok(hint.includes("КОРПУС ХУКОВ"), "combined hints include hooks section");
ok(hint.includes("ЧАСТО БРАКУЮТ"), "combined hints include reject section");
ok(!hint.includes("очень ".repeat(40)), "combined hints clamp very long values");
ok(hint.length < 1800, "combined hints stay bounded");

const broken = fakeDb({}, true);
ok(await winnersHintFor(broken, "bags") === "", "winners hint fails open");
ok(await corpusHooksFor(broken, "bags") === "", "corpus hooks hint fails open");
ok(await rejectAntiFor(broken, "bags") === "", "reject anti hint fails open");
ok(await learningHints(broken, "bags") === "", "combined learning hints fail open");
ok(await learningHints(db, "") === "", "empty niche returns empty hints");

const platformDb = fakeDb({
  content_assets: [
    { winner_learnings: { hook: "тикток хук", target_platform: "tiktok" }, name: "тикток хук" },
    { winner_learnings: { hook: "инста хук", target_platform: "instagram" }, name: "инста хук" },
  ],
});
const platformHint = await winnersHintFor(platformDb, "bags", "Instagram");
ok(platformHint.includes("инста хук"), "winners hint filters by target platform");
ok(!platformHint.includes("тикток хук"), "winners hint excludes other platform winners");

const seedFallbackDb = fakeDb({
  content_assets: [],
  viral_videos: [
    { hook_text: "рыночный тикток хук", platform: "tiktok", virality_score: 40, analyzed: true },
    { hook_text: "рыночный инста хук", platform: "instagram", virality_score: 39, analyzed: true },
  ],
});
const seedHint = await winnersHintFor(seedFallbackDb, "bags", "tiktok");
ok(seedHint.includes("КОРПУС-ПОБЕДИТЕЛИ"), "winners hint falls back to viral corpus when no product winners");
ok(seedHint.includes("рыночный тикток хук"), "winners hint uses analyzed viral corpus as fallback");
ok(!seedHint.includes("рыночный инста хук"), "winners hint fallback respects target platform");

if (failed) process.exit(1);
console.log(`learningHints: ${passed} passed, ${failed} failed`);
