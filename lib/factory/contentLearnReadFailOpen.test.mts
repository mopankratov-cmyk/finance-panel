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

const route = readFileSync("app/api/factory/content-learn/route.ts", "utf8");
const getRoute = route.split("export async function GET")[1] || route;

ok(/ok: true, profiles: \[\], warning: "Supabase не настроен — визуальное обучение временно пустое"/.test(getRoute), "content-learn GET missing-db path returns empty profile list");
ok(/ok: true, profiles: niche \? null : \[\], warning: error\.message/.test(getRoute), "content-learn GET query errors are warning-only");
ok(/ok: true,[\s\S]*profiles: null,[\s\S]*warning: "чтение обучения контента упало: "/.test(getRoute), "content-learn GET crash path is warning-only");
ok(!/чтение обучения контента упало[\s\S]*status:\s*500/.test(getRoute), "content-learn GET no longer returns HTTP 500");

if (failed) process.exit(1);
console.log(`contentLearnReadFailOpen: ${passed} passed, ${failed} failed`);
