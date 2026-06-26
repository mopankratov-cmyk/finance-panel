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

const status = readFileSync("app/api/factory/status/route.ts", "utf8");
const toolSchema = readFileSync("app/api/factory/tool-schema/route.ts", "utf8");
const studio = readFileSync("public/inferno/studio.html", "utf8");

ok(/partial: true,[\s\S]*warning: "Supabase не настроен — проверка таблиц пропущена"/.test(status), "status missing-db path keeps dashboard alive");
ok(/partial: true,[\s\S]*warning: "статус завода упал: "/.test(status), "status crash path returns warning metadata");
ok(!/статус завода упал[\s\S]*status:\s*500/.test(status), "status crash path no longer returns HTTP 500");
ok(/partial: true,[\s\S]*warning: "схема инструментов упала: "/.test(toolSchema), "tool-schema crash path returns fallback registry");
ok(/tools: \[\],[\s\S]*schemas: \{\}/.test(toolSchema), "tool-schema fallback preserves list contract");
ok(!/схема инструментов упала[\s\S]*status:\s*500/.test(toolSchema), "tool-schema crash path no longer returns HTTP 500");
ok(/\(r&&r\.schema\)\|\|\{tool:S\.tool,label:S\.tool,available:false,groups:\[\]\}/.test(studio), "Studio inspector falls back when tool schema is unavailable");
ok(/!Array\.isArray\(sch\.groups\)\|\|!sch\.groups\.length/.test(studio), "Studio inspector handles empty tool schema without throwing");

if (failed) process.exit(1);
console.log(`statusToolSchemaFailOpen: ${passed} passed, ${failed} failed`);
