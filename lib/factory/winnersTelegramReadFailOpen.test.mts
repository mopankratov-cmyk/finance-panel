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

const winners = readFileSync("app/api/factory/winners/route.ts", "utf8");
const telegram = readFileSync("app/api/factory/telegram/route.ts", "utf8");
const winnersGet = winners.split("export async function GET")[1] || winners;
const telegramGet = telegram.split("export async function GET")[1]?.split("export async function POST")[0] || telegram;

ok(/warning: "Supabase не настроен — победители временно пустые"/.test(winnersGet), "winners GET missing-db path is warning-only");
ok(/warning: "чтение победителей упало: "/.test(winnersGet), "winners GET crash path is warning-only");
ok(!/чтение победителей упало[\s\S]*status:\s*500/.test(winnersGet), "winners GET no longer returns HTTP 500");
ok(/ok: true,[\s\S]*partial: true,[\s\S]*warning: "чтение Telegram упало: "/.test(telegramGet), "telegram GET crash path is warning-only");
ok(!/чтение Telegram упало[\s\S]*ok:\s*false/.test(telegramGet), "telegram GET no longer reports read-only crash as ok:false");

if (failed) process.exit(1);
console.log(`winnersTelegramReadFailOpen: ${passed} passed, ${failed} failed`);
