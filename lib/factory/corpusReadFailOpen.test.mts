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

const topHooks = readFileSync("app/api/factory/corpus/top-hooks/route.ts", "utf8");
const topSounds = readFileSync("app/api/factory/corpus/top-sounds/route.ts", "utf8");
const topVideos = readFileSync("app/api/factory/corpus/top-videos/route.ts", "utf8");

ok(/warning: "Supabase не настроен — корпус хуков временно пустой"/.test(topHooks), "top-hooks missing-db path is warning-only");
ok(/warning: "Supabase не настроен — корпус звуков временно пустой"/.test(topSounds), "top-sounds missing-db path is warning-only");
ok(/warning: "Supabase не настроен — корпус видео временно пустой"/.test(topVideos), "top-videos missing-db path is warning-only");
ok(/warning: "топ видео упал: "/.test(topVideos), "top-videos crash path is warning-only");
ok(!/Supabase не настроен[\s\S]*status:\s*500/.test(topVideos), "top-videos no longer returns HTTP 500 for read-only corpus fetches");

if (failed) process.exit(1);
console.log(`corpusReadFailOpen: ${passed} passed, ${failed} failed`);
