import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Regression: аудит панели 29.09.2026 (находка №3) нашёл, что 202607310002
// закрыла anon/authenticated только на таблицах, существовавших на тот
// момент, — а новые таблицы снова получают дефолтные PostgREST-права, пока
// конкретная миграция явно их не отзовёт. Живая проверка на локальном
// Postgres (создание ролей anon/authenticated/service_role, alter default
// privileges, применение реальных create-table-миграций, затем этой
// миграции) подтвердила: до фикса `set role anon; select ...` проходил на
// всех 18 таблицах, после — «permission denied» у anon/authenticated и
// полный доступ у service_role. Этот тест проверяет только текст миграции
// (её нельзя выполнить как часть обычного npm test — нужны роли Supabase),
// живую проверку не заменяет, но ловит будущую правку не глядя.

const migration = new URL(
  "../supabase/migrations/202609290001_close_anon_authenticated_exposed_tables.sql",
  import.meta.url,
);

const SHELF_TABLES = [
  "wb_shelf_watch",
  "wb_shelf_cabinet_settings",
  "wb_shelf_snapshots",
  "wb_shelf_snapshot_rows",
  "wb_sku_order",
];

const OZON_TABLES = [
  "ozon_cockpit_cache",
  "ozon_ad_daily",
  "ozon_accrual_rows",
  "ozon_postings",
  "ozon_accrual_types",
];

const PAYROLL_LOAN_TABLES = [
  "payroll_employees",
  "payroll_periods",
  "payroll_entries",
  "payroll_debt_openings",
  "payroll_payment_allocations",
  "payroll_employee_private",
  "finance_loan_documents",
  "loan_schedule_rows",
];

test("все 18 таблиц лишаются grant у anon и authenticated разом", async () => {
  const sql = await readFile(migration, "utf8");
  const revokeStatements = sql.match(/revoke all on[^;]*from anon, authenticated;/g) ?? [];
  assert.equal(revokeStatements.length, 3, "по одному revoke-блоку на группу (склад «Полок», Ozon, зарплата/займы)");
  const revokedText = revokeStatements.join("\n");
  for (const table of [...SHELF_TABLES, ...OZON_TABLES, ...PAYROLL_LOAN_TABLES]) {
    assert.match(revokedText, new RegExp(`public\\.${table}\\b`), `${table} должна быть в списке revoke`);
  }
});

test("все 18 таблиц получают grant у service_role", async () => {
  const sql = await readFile(migration, "utf8");
  const grantStatements = sql.match(/grant all on[^;]*to service_role;/g) ?? [];
  assert.equal(grantStatements.length, 3);
  const grantedText = grantStatements.join("\n");
  for (const table of [...SHELF_TABLES, ...OZON_TABLES, ...PAYROLL_LOAN_TABLES]) {
    assert.match(grantedText, new RegExp(`public\\.${table}\\b`), `${table} должна быть в списке grant to service_role`);
  }
});

test("склад «Полок» и ручной порядок SKU включают RLS явно — у них её не было вовсе", async () => {
  const sql = await readFile(migration, "utf8");
  for (const table of SHELF_TABLES) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`));
  }
});

test("5 таблиц Ozon: снята политика с именем «service role manages …», которая на деле действовала на PUBLIC", async () => {
  const sql = await readFile(migration, "utf8");
  const dropStatements = sql.match(/drop policy if exists "[^"]*" on public\.\w+;/g) ?? [];
  assert.equal(dropStatements.length, 5, "по одной политике на каждую ozon-таблицу");
  for (const table of OZON_TABLES) {
    assert.match(sql, new RegExp(`drop policy if exists "[^"]*" on public\\.${table};`));
  }
  // Ни одна из этих политик не пересоздаётся — доступ идёт только через
  // service_role (revoke/grant), как и у остальных корректно защищённых
  // таблиц в этом репозитории, а не через `to <role>` в самой политике.
  assert.doesNotMatch(sql, /create policy/);
});

test("зарплата и займы получают только revoke — RLS у них уже включена собственной миграцией, повторно не включаем", async () => {
  const sql = await readFile(migration, "utf8");
  for (const table of PAYROLL_LOAN_TABLES) {
    assert.doesNotMatch(
      sql,
      new RegExp(`alter table public\\.${table} enable row level security;`),
      `${table}: RLS уже включена в 202609020003/202609020004/202609040002, повторное alter table здесь лишнее`,
    );
  }
});
