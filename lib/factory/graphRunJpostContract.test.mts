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

const graphRun = readFileSync("lib/factory/graphRun.ts", "utf8");

ok(/const text = await withTimeout\(r\.text\(\), Math\.max\(5000, Math\.floor\(ms \/ 2\)\), `\$\{path\} body`\);/.test(graphRun), "jpost reads response body as text once");
ok(/JSON\.parse\(text\)/.test(graphRun), "jpost parses JSON explicitly");
ok(/throw new Error\(`\$\{path\} invalid JSON:/.test(graphRun), "invalid JSON is surfaced as an error");
ok(/throw new Error\(`\$\{path\} empty body`\)/.test(graphRun), "empty successful bodies are surfaced as errors");
ok(!/r\.json\(\)\.catch\(\(\) => \(\{\}\)\)/.test(graphRun), "jpost no longer masks body parse failures as empty objects");

if (failed) process.exit(1);
console.log(`graphRunJpostContract: ${passed} passed, ${failed} failed`);
