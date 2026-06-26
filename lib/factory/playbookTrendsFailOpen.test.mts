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

const cached = readFileSync("app/api/factory/niche-playbook/cached/route.ts", "utf8");
const trends = readFileSync("app/api/factory/trends/route.ts", "utf8");
const history = readFileSync("app/api/factory/generation-history/route.ts", "utf8");

ok(/warning: "Supabase не настроен — кэш плейбука временно пустой"/.test(cached), "cached playbook missing-db path is warning-only");
ok(/warning: "niche_playbooks не применена"/.test(cached), "cached playbook missing migration is warning-only");
ok(/warning: "кэш плейбука ниши упал: "/.test(cached), "cached playbook crash path is warning-only");
ok(/warning: "тренды упали: "/.test(trends), "trends outer crash path is warning-only");
ok(!/тренды упали[\s\S]*status:\s*500/.test(trends), "trends outer crash path no longer returns HTTP 500");
ok(/history: \[\], warning: String/.test(history), "generation-history crash path uses warning field");

if (failed) process.exit(1);
console.log(`playbookTrendsFailOpen: ${passed} passed, ${failed} failed`);
