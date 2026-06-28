import { readFileSync } from "node:fs";
import { winnersHintFor } from "./learningHints";

let passed = 0;
let failed = 0;

function ok(cond: boolean, msg: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", msg);
  }
}

const source = readFileSync("lib/factory/learningHints.ts", "utf8");

ok(/export async function winnersHintFor/.test(source), "learning hints keep winners section");
ok(/export async function corpusHooksFor/.test(source), "learning hints keep corpus hooks section");
ok(/export async function rejectAntiFor/.test(source), "learning hints keep reject anti-pattern section");
ok(/export async function improvementHintFor/.test(source), "learning hints expose improvement section");
ok(/export async function batchPlanHintFor/.test(source), "learning hints expose batch plan section");
ok(/loadImprovementSnapshot/.test(source), "learning hints read improvement snapshot");
ok(/renderImprovementHints/.test(source), "learning hints render improvement hints");
ok(/renderBatchPlanHint/.test(source), "learning hints render batch plan hints");
ok(/Promise\.all\(\[winnersHintFor\(db, niche, targetPlatform\), corpusHooksFor\(db, niche\), rejectAntiFor\(db, niche\), improvementHintFor\(db, niche\), batchPlanHintFor\(db, niche\)\]\)/.test(source), "combined learning hints include platform winners, improvement loop and batch plan");

type FakeRow = Record<string, any>;

function fakeDb(tables: Record<string, FakeRow[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] || [])];
      const chain = {
        select() { return chain; },
        eq(key: string, value: unknown) {
          rows = rows.filter((row) => row[key] === value);
          return chain;
        },
        order() { return chain; },
        limit(count: number) {
          return Promise.resolve({ data: rows.slice(0, count), error: null });
        },
      };
      return chain;
    },
  } as any;
}

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
