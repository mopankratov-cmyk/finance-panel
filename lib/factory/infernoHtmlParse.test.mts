import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Script } from "node:vm";

let passed = 0;
let failed = 0;

function ok(cond: boolean, msg: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", msg);
  }
}

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(file);
    return entry.name.endsWith(".html") ? [file] : [];
  });
}

const files = htmlFiles("public/inferno").sort();
ok(files.length > 0, "Inferno public HTML files are present");

for (const file of files) {
  const html = readFileSync(file, "utf8");
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  try {
    scripts.forEach((script, idx) => new Script(script, { filename: `${file}#script${idx + 1}` }));
    ok(true, `${file} inline scripts parse`);
  } catch (e) {
    console.error(e);
    ok(false, `${file} inline scripts parse`);
  }
}

if (failed) process.exit(1);
console.log(`infernoHtmlParse: ${passed} passed, ${failed} failed`);
