import { readFileSync } from "node:fs";

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
ok(/Promise\.all\(\[winnersHintFor\(db, niche\), corpusHooksFor\(db, niche\), rejectAntiFor\(db, niche\), improvementHintFor\(db, niche\), batchPlanHintFor\(db, niche\)\]\)/.test(source), "combined learning hints include improvement loop and batch plan");

if (failed) process.exit(1);
console.log(`learningHints: ${passed} passed, ${failed} failed`);
