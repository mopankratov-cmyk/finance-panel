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

const files = [
  ["creatify-options", "app/api/factory/creatify-options/route.ts"],
  ["creatify-avatars", "app/api/factory/creatify-avatars/route.ts"],
  ["creatify-voices", "app/api/factory/creatify-voices/route.ts"],
  ["creatify-music", "app/api/factory/creatify-music/route.ts"],
  ["creatify-credits", "app/api/factory/creatify-credits/route.ts"],
] as const;

for (const [name, file] of files) {
  const src = readFileSync(file, "utf8");
  ok(!/status:\s*5\d\d/.test(src), `${name} read-only provider route does not return 5xx`);
  ok(/warning|note/.test(src), `${name} exposes warning/note metadata on degraded provider reads`);
}

if (failed) process.exit(1);
console.log(`providerOptionsFailOpen: ${passed} passed, ${failed} failed`);
