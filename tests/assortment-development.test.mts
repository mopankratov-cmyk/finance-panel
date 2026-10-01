import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canAccess } from "../lib/auth/roles.ts";
import { apiPermissionFor } from "../lib/auth/apiPermissions.ts";
import { ASSORTMENT_ROLES, parseDirection } from "../lib/assortment/constants.ts";
import { sortSources, summarizeCoverage, type AssortmentSource } from "../lib/assortment/coverage.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const migration = readFileSync(join(root, "supabase/migrations/202610010005_assortment_development_schema.sql"), "utf8");

/**
 * Модуль «Разработка ассортимента» (ТЗ v3.0 от 01.10.2026).
 * Границы ТЗ проверяются здесь, потому что ломаются тихо: колонка цены в
 * миграции или роут без проверки роли не дают ошибки ни в сборке, ни в UI.
 */

test("в схеме модуля нет цен, валют, себестоимости, маржи, СПП, бюджетов и MOQ", () => {
  const columnLines = migration
    .split("\n")
    .filter((line) => /^\s{2}[a-z_]+\s+(text|integer|numeric|uuid|jsonb|boolean|timestamptz|text\[\])/.test(line));
  assert.ok(columnLines.length > 40, "колонки таблиц найдены");
  for (const line of columnLines) {
    const column = line.trim().split(/\s+/)[0];
    assert.doesNotMatch(column, /price|cost|margin|currency|spp|moq|budget/i, `колонка ${column} нарушает границу ТЗ`);
  }
});

test("паспорт источников: ровно 127 записей S001–S127 со статусами проб этапа 0", () => {
  const ids = [...migration.matchAll(/^\s{2}\('(S\d{3})'/gm)].map((m) => m[1]);
  assert.equal(ids.length, 127);
  assert.equal(new Set(ids).size, 127);
  const statusOf = (id: string) => migration.match(new RegExp(`\\('${id}',[^\\n]*?'(auto_verified|partial|manual_only|untested|disabled)'`))?.[1];
  for (const id of ["S014", "S027", "S024", "S026", "S028"]) assert.equal(statusOf(id), "auto_verified", id);
  assert.equal(statusOf("S001"), "partial");
  for (const id of ["S002", "S003", "S005", "S008"]) assert.equal(statusOf(id), "manual_only", id);
  assert.equal(statusOf("S025"), "disabled");
});

test("таблицы закрыты от anon и authenticated", () => {
  assert.match(migration, /revoke all on public\.assortment_sources[\s\S]*from anon, authenticated;/);
  const tables = [...migration.matchAll(/create table if not exists public\.(assortment_\w+)/g)].map((m) => m[1]);
  for (const table of tables) assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security;`), table);
});

test("страницы модуля открыты руководителю, закупщику и менеджеру WB, но не внешним ролям", () => {
  for (const role of ["director", "buyer", "wb_manager"] as const) {
    assert.equal(canAccess(role, "/assortment-development/jackets"), true, role);
    assert.equal(canAccess(role, "/assortment-development/bags"), true, role);
  }
  for (const role of ["seller", "seller_owner", "warehouse", "hr", "ozon_manager", "fin_director", "financier"] as const) {
    assert.equal(canAccess(role, "/assortment-development/bags"), false, role);
  }
});

test("API модуля описан в карте прав", () => {
  assert.deepEqual(apiPermissionFor("/api/assortment-development/sources", "GET"), { permission: "analytics.view" });
  assert.deepEqual(apiPermissionFor("/api/assortment-development/sources", "POST"), { permission: "analytics.view" });
});

test("каждый роут модуля сам проверяет круг ролей (у внешних ролей тоже есть analytics.view)", () => {
  assert.deepEqual(ASSORTMENT_ROLES, ["director", "buyer", "wb_manager"]);
  const dir = join(root, "app/api/assortment-development");
  const routes: string[] = [];
  const walk = (path: string) => {
    for (const entry of readdirSync(path)) {
      const full = join(path, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "route.ts") routes.push(full);
    }
  };
  walk(dir);
  assert.ok(routes.length > 0);
  for (const file of routes) {
    assert.match(readFileSync(file, "utf8"), /requireApiSession\(ASSORTMENT_ROLES\)/, file);
  }
});

test("раздел из адреса: только jackets и bags", () => {
  assert.equal(parseDirection("bags"), "bags");
  assert.equal(parseDirection("shoes"), null);
  assert.equal(parseDirection(null), null);
});

test("покрытие показывает, что реально отслеживается, а рабочие источники идут первыми", () => {
  const source = (sourceId: string, name: string, accessStatus: AssortmentSource["accessStatus"], priority = "P0"): AssortmentSource =>
    ({ sourceId, name, group: null, categories: ["bags"], region: null, priority, adapterType: null, accessStatus, accessNote: null, lastSuccessAt: null });
  const sorted = sortSources([
    source("S002", "Mango", "manual_only"),
    source("S090", "Кандидат", "untested", "P1"),
    source("S024", "Polène", "auto_verified"),
    source("S001", "Zara", "partial"),
  ]);
  assert.deepEqual(sorted.map((s) => s.name), ["Polène", "Zara", "Mango", "Кандидат"]);
  assert.deepEqual(summarizeCoverage(sorted), { auto: ["Polène"], partial: ["Zara"], manual: ["Mango"] });
});
