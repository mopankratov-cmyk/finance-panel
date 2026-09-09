import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { API_RULES, apiAccessFor, apiPermissionFor } from "../lib/auth/apiPermissions.ts";
import { ROLE_PERMISSIONS, roleCan, type Role } from "../lib/auth/permissions.ts";

/**
 * Карта прав обязана накрывать API целиком.
 *
 * ТЗ заканчивается строкой «закрытые данные нельзя получить через прямую
 * ссылку, API или выгрузку». Единственный способ это удержать — считать
 * роуты машиной: человек новый эндпоинт в таблицу не впишет, а забудет.
 */

const API_DIR = fileURLToPath(new URL("../app/api", import.meta.url));
const APP_DIR = fileURLToPath(new URL("../app", import.meta.url));

function routeFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...routeFiles(full));
    else if (name === "route.ts") found.push(full);
  }
  return found;
}

/** Обработчики бывают объявлены прямо, а бывают перевывезены из соседнего
 *  роута: `export { GET, POST } from "…"`. Второе — тоже полноценный роут. */
function methodsOf(source: string): string[] {
  const declared = [...source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/g)].map((m) => m[1]);
  const reexported = [...source.matchAll(/export\s*\{([^}]*)\}\s*from/g)]
    .flatMap((m) => m[1].split(","))
    .map((name) => name.trim().split(/\s+as\s+/).pop()!.trim())
    .filter((name) => ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(name));
  return [...new Set([...declared, ...reexported])];
}

const ROUTES = routeFiles(API_DIR).map((file) => ({
  url: "/" + relative(APP_DIR, file).replace(/\/route\.ts$/, ""),
  methods: methodsOf(readFileSync(file, "utf8")),
}));

test("в панели есть роуты, и их читает тест, а не догадка", () => {
  assert.ok(ROUTES.length > 200, `найдено роутов: ${ROUTES.length}`);
  assert.ok(ROUTES.every((route) => route.methods.length > 0), "роут без единого обработчика");
});

test("каждый эндпоинт назван в карте прав", () => {
  // Падение здесь означает ровно одно: появился роут, про который никто не
  // сказал, кому он открыт. Дописать строку в карту — минута; найти дыру
  // через полгода — нет.
  const missing = ROUTES.filter((route) => apiAccessFor(route.url) === null).map((route) => route.url);
  assert.deepEqual(missing, [], `не описаны в lib/auth/apiPermissions.ts:\n  ${missing.join("\n  ")}`);
});

test("в карте нет строк без роутов", () => {
  // Устаревшее правило хуже отсутствующего: оно выглядит как защита, но
  // не защищает ничего, потому что путь давно переименован.
  const stale = API_RULES.filter(([path]) => !ROUTES.some((route) => (
    path.endsWith("/") ? route.url.startsWith(path) : route.url === path
  ))).map(([path]) => path);
  assert.deepEqual(stale, [], `правила без роутов:\n  ${stale.join("\n  ")}`);
});

test("у каждого метода каждого роута есть ответ, кому он открыт", () => {
  const holes: string[] = [];
  for (const route of ROUTES) {
    for (const method of route.methods) {
      if (apiPermissionFor(route.url, method) === null) holes.push(`${method} ${route.url}`);
    }
  }
  assert.deepEqual(holes, []);
});

test("мутации не отдаются под правом на чтение", () => {
  // Отдельная ловушка на невнимательность: строка вида
  // { read: "cost.view", write: "cost.view" } читается как описанная, но
  // означает «менять может каждый, кто смотрит».
  const suspicious: string[] = [];
  const READ_ONLY = new Set(["analytics.view", "warehouse.view", "cost.view", "finance.view", "mp_reports.view", "payroll.view", "hr.view", "audit.view"]);
  for (const route of ROUTES) {
    for (const method of route.methods) {
      if (method === "GET") continue;
      const access = apiPermissionFor(route.url, method);
      if (access && "permission" in access && READ_ONLY.has(access.permission)) {
        suspicious.push(`${method} ${route.url} → ${access.permission}`);
      }
    }
  }
  // Список исключений ведётся руками и сознательно: это витрины, где POST
  // пересчитывает кэш из уже доступных чисел, и заявки, которые роут сам
  // держит в границах своей организации.
  const ALLOWED = new Set([
    "/api/abc", "/api/agent", "/api/agent/insights", "/api/agent/insights/generate",
    "/api/market/niches", "/api/market/pulse", "/api/operational-health",
    "/api/opiu/margin",
    "/api/rnp/[shop]/operations", "/api/rnp/[shop]/plan", "/api/rnp/[shop]/table", "/api/rnp/[shop]/unit-econ",
    "/api/shelf/table", "/api/shelf/watch", "/api/shops", "/api/signals", "/api/sku-order", "/api/trends",
    "/api/unit/calc-skus", "/api/unit/refresh-cogs", "/api/unit/refresh-prices", "/api/unit/refresh-status",
    "/api/unit/refresh-stocks", "/api/unit/table",
    "/api/warehouse/balances", "/api/warehouse/entities", "/api/warehouse/events", "/api/warehouse/stock", "/api/warehouse/todo",
    "/api/wb/competitors", "/api/wb/ctr-breakdown", "/api/wb/ctr-notes", "/api/wb/losses", "/api/wb/rk-notes",
    "/api/wb/rk-journal", "/api/wb/sku-directory", "/api/wb/sync-health", "/api/wb/cabinet-rights",
    "/api/ozon/losses", "/api/ozon/ad-journal", "/api/ozon/ad-sku", "/api/ozon/analytics",
    "/api/ozon/campaigns", "/api/ozon/cockpit", "/api/ozon/rnp", "/api/ozon/stocks", "/api/ozon/unit",
  ]);
  const unexpected = suspicious.filter((line) => !ALLOWED.has(line.split(" ")[1]));
  assert.deepEqual(unexpected, [], `мутация под правом на чтение:\n  ${unexpected.join("\n  ")}`);
});

test("фулфилменту не открывается ни один финансовый или товарный эндпоинт", () => {
  // Самая узкая роль в ТЗ — по ней и проверяем, что карта и матрица сходятся.
  const leaks: string[] = [];
  for (const route of ROUTES) {
    for (const method of route.methods) {
      const access = apiPermissionFor(route.url, method);
      if (!access || "open" in access) continue;
      if (!roleCan("warehouse", access.permission)) continue;
      if (!route.url.startsWith("/api/warehouse")) leaks.push(`${method} ${route.url} → ${access.permission}`);
    }
  }
  assert.deepEqual(leaks, [], `оператору склада открыто лишнее:\n  ${leaks.join("\n  ")}`);
});

test("ни одна роль не получает больше, чем ей выдано матрицей", () => {
  // Карта не должна уметь выдавать право, которого нет в матрице: иначе
  // таблица роутов тихо станет вторым источником правды.
  const known = new Set(Object.values(ROLE_PERMISSIONS).flat());
  for (const route of ROUTES) {
    for (const method of route.methods) {
      const access = apiPermissionFor(route.url, method);
      if (access && "permission" in access) {
        assert.ok(known.has(access.permission), `${method} ${route.url}: право «${access.permission}» не выдано ни одной роли`);
      }
    }
  }
});

test("машинные роуты не притворяются человеческими", () => {
  // Роут с пометкой «только крон» обязан сам проверять секрет: пометка в
  // карте — описание, а не защита.
  const cronRoutes = ROUTES.filter((route) => {
    const access = apiAccessFor(route.url);
    return access && "open" in access && access.open === "cron";
  });
  assert.ok(cronRoutes.length > 20, `машинных роутов найдено ${cronRoutes.length}`);
  for (const route of cronRoutes) {
    const src = readFileSync(join(API_DIR, route.url.replace("/api/", ""), "route.ts"), "utf8");
    assert.match(src, /checkCronAuth|CRON_SECRET|isMachineReadRequest|requireApiSession/, `${route.url}: помечен машинным, но своего сторожа нет`);
  }
});

test("у каждой роли есть хотя бы один открытый ей эндпоинт", () => {
  // Роль без единого доступного роута — это не роль, а обещание. Такое
  // расхождение между матрицей и картой ловится только счётом.
  for (const role of Object.keys(ROLE_PERMISSIONS) as Role[]) {
    const reachable = ROUTES.some((route) => route.methods.some((method) => {
      const access = apiPermissionFor(route.url, method);
      return access !== null && "permission" in access && roleCan(role, access.permission);
    }));
    assert.ok(reachable, `роли ${role} не открыт ни один эндпоинт`);
  }
});
