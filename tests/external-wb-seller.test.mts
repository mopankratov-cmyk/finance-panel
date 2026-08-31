import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { sessionHasCabinetAccess } from "../lib/auth/cabinetAccess";
import { canAccess, ROLE_HOME } from "../lib/auth/roles";
import { assertUnitScopeAccess, UnitScopeError } from "../lib/unit/groupScope";

const OWN = "00000000-0000-4000-8000-00000000000a";
const FOREIGN = "00000000-0000-4000-8000-00000000000b";

test("external seller can open only the WB analytics contour", () => {
  assert.equal(ROLE_HOME.seller, "/wb/connect");
  for (const page of ["/wb/connect", "/wb/rnp", "/wb/adverts", "/wb/unit", "/wb/product"]) {
    assert.equal(canAccess("seller", page), true, page);
  }
  for (const page of ["/", "/pnl", "/calendar", "/ozon", "/users", "/cabinets", "/agent"]) {
    assert.equal(canAccess("seller", page), false, page);
  }
});

test("production sessions fail closed without AUTH_SECRET", async () => {
  const source = await readFile(new URL("../lib/auth/session.ts", import.meta.url), "utf8");
  assert.match(source, /!configured && process\.env\.NODE_ENV === "production"/);
  assert.match(source, /AUTH_SECRET обязателен в production/);
});

test("internal login survives the short deployment window before tenant migration", async () => {
  const sources = await Promise.all([
    readFile(new URL("../lib/auth/server.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth/users.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/users/route.ts", import.meta.url), "utf8"),
  ]);
  for (const source of sources) {
    assert.match(source, /error\?\.code === "42703"/);
    assert.match(source, /organization_id: null/);
  }
});

test("external seller cabinet access is exact and empty never means all", () => {
  const seller = { role: "seller" as const, cabinet_ids: [OWN] };
  assert.equal(sessionHasCabinetAccess(seller, OWN), true);
  assert.equal(sessionHasCabinetAccess(seller, FOREIGN), false);
  assert.equal(sessionHasCabinetAccess(seller, "all"), false);
  assert.equal(sessionHasCabinetAccess(seller, "group:1"), false);
  assert.equal(sessionHasCabinetAccess({ role: "seller", cabinet_ids: [] }, OWN), false);
  assert.throws(
    () => assertUnitScopeAccess(seller, { mode: "all", scopeKey: "all" }),
    (error: unknown) => error instanceof UnitScopeError && error.status === 403,
  );
});

test("seller API policy is GET allowlisted and all other mutations are denied", async () => {
  const source = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");
  assert.match(source, /if \(method !== "GET"\) return false/);
  assert.match(source, /pathname === "\/api\/cabinets\/self-service"[\s\S]+method === "GET" \|\| method === "POST"/);
  assert.doesNotMatch(source, /SELLER_READ_API_(?:EXACT|PREFIXES)[\s\S]{0,1000}"\/api\/finance/);
  assert.doesNotMatch(source, /SELLER_READ_API_(?:EXACT|PREFIXES)[\s\S]{0,1000}"\/api\/sync/);
});

test("self-service validates scopes, binds organization and never returns the raw token", async () => {
  const source = await readFile(new URL("../app/api/cabinets/self-service/route.ts", import.meta.url), "utf8");
  assert.match(source, /session\.role !== "seller"/);
  assert.match(source, /missingScopes\.length > 0/);
  assert.match(source, /organization_id: organizationId/);
  assert.match(source, /claimMarketplaceSeller\(db, "wb"/);
  assert.match(source, /session\.cabinet_ids/);
  assert.match(source, /token_mask: mask\(token\)/);
  const successStart = source.indexOf("const response = NextResponse.json({");
  const successEnd = source.indexOf("response.cookies.set", successStart);
  assert.ok(successStart >= 0 && successEnd > successStart, "success response must be inspectable");
  const successResponse = source.slice(successStart, successEnd);
  assert.match(successResponse, /token_mask: mask\(token\)/);
  assert.doesNotMatch(successResponse, /\n\s+token\s*[,}]/);
  assert.doesNotMatch(successResponse, /\n\s+token:\s*token/);
});

test("switching an internal account to seller creates a separate tenant", async () => {
  const routes = await Promise.all([
    readFile(new URL("../app/api/users/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/users/[id]/route.ts", import.meta.url), "utf8"),
  ]);
  const [collection, single] = routes;
  for (const source of routes) assert.match(source, /createSellerOrganization/);
  // Создание сотрудника: селлер заводится в своей организации и без списка
  // кабинетов — доступ он получает через организацию, а не поимённо.
  assert.match(collection, /role === "seller" \|\| role === "warehouse" \? \[\]/);
  // Смена роли уже существующему: тенант определяется видом организации, а
  // кабинеты берутся из неё же. Обнулять список здесь нельзя — это отрезало бы
  // селлера от кабинета ровно в момент выдачи роли.
  assert.match(single, /organizationNow\?\.kind[\s\S]{0,80}!== "seller"/);
  assert.match(single, /patch\.cabinet_ids/);
});

test("database migrations create tenants and close browser access to business data", async () => {
  const [tenancy, closed] = await Promise.all([
    readFile(new URL("../supabase/migrations/202607310001_external_wb_seller_tenancy.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202607310002_close_public_business_data.sql", import.meta.url), "utf8"),
  ]);
  assert.match(tenancy, /create table if not exists public\.organizations/);
  assert.match(tenancy, /alter table public\.app_users[\s\S]+organization_id/);
  assert.match(tenancy, /alter table public\.wb_cabinets[\s\S]+organization_id/);
  assert.match(tenancy, /create table if not exists public\.marketplace_tenant_claims/);
  assert.match(tenancy, /primary key \(marketplace, seller_id\)/);
  assert.match(closed, /revoke all privileges on all tables in schema public from anon, authenticated/);
  assert.match(closed, /revoke all privileges on all functions in schema public from anon, authenticated/);
});

async function sourceFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await sourceFiles(full));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) result.push(full);
  }
  return result;
}

test("browser source no longer imports the public Supabase client", async () => {
  const roots = [path.resolve("components"), path.resolve("app"), path.resolve("lib")];
  const files = (await Promise.all(roots.map(sourceFiles))).flat()
    .filter((file) => !file.endsWith(path.join("lib", "supabase.ts")));
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /from ["']@\/lib\/supabase["']|from ["']\.\/?supabase["']/, file);
  }
});

test("finance browser calls are guarded by director or finance server routes", async () => {
  const routes = await Promise.all([
    readFile(new URL("../app/api/finance/state/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/finance/companies/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/finance/import/route.ts", import.meta.url), "utf8"),
  ]);
  for (const source of routes) assert.match(source, /requireApiSession\(\["director", "finance"\]\)/);
});
