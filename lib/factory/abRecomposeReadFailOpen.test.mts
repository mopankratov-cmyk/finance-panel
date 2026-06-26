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

const abRank = readFileSync("app/api/factory/ab-rank/route.ts", "utf8");
const recompose = readFileSync("app/api/factory/reel-recompose/route.ts", "utf8");
const recomposeGet = recompose.split("export async function GET")[1] || recompose;

ok(/warning: "Supabase не настроен — A\/B ранжирование временно пустое"/.test(abRank), "ab-rank missing-db path is warning-only");
ok(/warning: "ранжирование A\/B упало: "/.test(abRank), "ab-rank outer crash path is warning-only");
ok(!/ранжирование A\/B упало[\s\S]*status:\s*500/.test(abRank), "ab-rank outer crash path no longer returns HTTP 500");
ok(/warning: "Supabase не настроен — статусы пересборки временно пустые"/.test(recomposeGet), "reel-recompose GET missing-db path is warning-only");
ok(/warning: "чтение пересборки рила упало: "/.test(recomposeGet), "reel-recompose GET crash path is warning-only");
ok(!/чтение пересборки рила упало[\s\S]*status:\s*500/.test(recomposeGet), "reel-recompose GET no longer returns HTTP 500");

if (failed) process.exit(1);
console.log(`abRecomposeReadFailOpen: ${passed} passed, ${failed} failed`);
