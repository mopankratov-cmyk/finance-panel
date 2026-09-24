import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { spreadOpiuPaymentEvenly, validateOpiuPaymentPeriodDrafts } from "./paymentPeriodAllocations.ts";

test("годовая подписка распределяется по месяцам без потери копеек", () => {
  const rows = spreadOpiuPaymentEvenly(10_000, "2026-01", 12);
  assert.equal(rows.length, 12);
  assert.equal(rows[0].month, "2026-01");
  assert.equal(rows[11].month, "2026-12");
  assert.equal(rows.reduce((sum, row) => sum + row.amount, 0), 10_000);
  assert.deepEqual(rows.slice(0, 4).map((row) => row.amount), [833.34, 833.34, 833.34, 833.34]);
});

test("распределение требует уникальные месяцы и точную сумму", () => {
  assert.throws(() => validateOpiuPaymentPeriodDrafts(-1_000, [
    { month: "2026-01", amount: 500 },
    { month: "2026-01", amount: 500 },
  ]), /указан дважды/);
  assert.throws(() => validateOpiuPaymentPeriodDrafts(-1_000, [
    { month: "2026-01", amount: 999.99 },
  ]), /Распределено/);
  assert.deepEqual(validateOpiuPaymentPeriodDrafts(-1_000, [
    { month: "2026-02", amount: 400 },
    { month: "2026-01", amount: 600 },
  ]), [
    { month: "2026-01", amount: 600 },
    { month: "2026-02", amount: 400 },
  ]);
});

test("миграция отделяет период ОПиУ от даты ДДС и защищает сумму", () => {
  const migration = readFileSync(new URL("../../supabase/migrations/202609240004_opiu_payment_period_allocations.sql", import.meta.url), "utf8");
  assert.match(migration, /create table if not exists public\.opiu_payment_period_allocations/);
  assert.match(migration, /Сумма распределения ОПиУ/u);
  assert.match(migration, /opiu_dds_facts_for_month/);
  assert.match(migration, /not exists \(\s*select 1 from public\.opiu_payment_period_allocations/s);
  assert.match(migration, /a\.period_month between p_from and p_to/);
});
