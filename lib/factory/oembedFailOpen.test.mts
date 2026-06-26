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

const route = readFileSync("app/api/factory/oembed/route.ts", "utf8");

ok(/if \(!db\) return NextResponse\.json\(\{ ok: true, items: \[\], warning: "Supabase не настроен — обложки конкурентов временно пустые" \}\)/.test(route), "oembed missing-db path is fail-open");
ok(/warning: "миграция 20260621_viral_covers не применена"/.test(route), "oembed migration miss is warning-only");
ok(/ok: true,[\s\S]*partial: true,[\s\S]*items: \[\],[\s\S]*warning: "oEmbed упал: "/.test(route), "oembed crash path is fail-open");
ok(!/oEmbed упал[\s\S]*ok:\s*false/.test(route), "oembed no longer reports read-only crash as ok:false");

if (failed) process.exit(1);
console.log(`oembedFailOpen: ${passed} passed, ${failed} failed`);
