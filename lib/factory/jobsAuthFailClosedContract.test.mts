import { ok } from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const FACTORY_API_ROOT = "app/api/factory";

function routeFiles(): string[] {
  return readdirSync(FACTORY_API_ROOT, { recursive: true })
    .map(String)
    .filter((p) => p.endsWith("route.ts"))
    .map((p) => join(FACTORY_API_ROOT, p));
}

// Роуты с CRON-авторизацией ходят через общий fail-closed helper, без локальных копий authOk.
{
  const migrated = [
    "app/api/factory/jobs/metrics-poll/route.ts",
    "app/api/factory/graph-run/rejudge/route.ts",
    "app/api/factory/memory-quality/route.ts",
  ];
  for (const file of migrated) {
    const src = readFileSync(file, "utf8");
    ok(src.includes("isAuthorizedReelsBrainJobRequest"), `${file}: авторизация через общий helper`);
    ok(/await isAuthorizedReelsBrainJobRequest\(req\)/.test(src), `${file}: async helper вызывается через await`);
    ok(!/function authOk/.test(src), `${file}: локальная копия authOk удалена`);
  }
}

// Fail-open паттерн «нет CRON_SECRET → пускаем всех» запрещён во всей зоне factory API.
{
  const files = routeFiles();
  ok(files.length > 100, `route-файлы найдены (${files.length})`);
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    ok(!/if\s*\(!secret\)\s*return true/.test(src), `${file}: без fail-open (!secret → пускаем всех)`);
  }
}

console.log("jobsAuthFailClosedContract: passed");
