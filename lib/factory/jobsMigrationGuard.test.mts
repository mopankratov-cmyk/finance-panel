import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

let passed = 0;
let failed = 0;

function ok(cond: boolean, msg: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", msg);
  }
}

const runtimeRoots = ["app/api/factory", "lib/factory", "public/inferno"];
const files: string[] = [];

function walk(dir: string) {
  if (!existsSync(dir)) return;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (/\.(ts|tsx|mjs|mts|html)$/.test(ent.name) && !ent.name.endsWith(".test.mts")) files.push(p);
  }
}

for (const root of runtimeRoots) walk(root);

const liveFiles = files.filter((file) => !file.startsWith("app/api/factory/jobs/"));
const oldRuntimeRefs: string[] = [];
const disabledJobCallers: string[] = [];
const staleComments: string[] = [];

for (const file of liveFiles) {
  const source = readFileSync(file, "utf8");
  if (/["']@?\/?\.?\.?\/?lib\/factory\/jobs["']|["']\.\/jobs["']|["']@\/lib\/factory\/jobs["']/.test(source)) {
    oldRuntimeRefs.push(file);
  }
  if (/\/api\/factory\/jobs\/(?:enqueue|list|tick)\b/.test(source)) {
    disabledJobCallers.push(file);
  }
  if (/self-chaining очередь|self-chaining queue|jobs\.ts|по образцу jobs\/tick|очередь воскресит/.test(source)) {
    staleComments.push(file);
  }
}

ok(!existsSync("lib/factory/jobs.ts"), "legacy lib/factory/jobs.ts is deleted");
ok(oldRuntimeRefs.length === 0, `no runtime imports of legacy jobs module:\n${oldRuntimeRefs.join("\n")}`);
ok(disabledJobCallers.length === 0, `no runtime callers of disabled jobs/enqueue|list|tick:\n${disabledJobCallers.join("\n")}`);
ok(staleComments.length === 0, `no live runtime comments describe graph-run as legacy jobs queue:\n${staleComments.join("\n")}`);

if (failed) process.exit(1);
console.log(`jobsMigrationGuard: ${passed} passed, ${failed} failed`);
