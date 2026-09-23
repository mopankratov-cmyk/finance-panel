import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../supabase/migrations/202609230001_dds_calendar_fact_links.sql", import.meta.url), "utf8");
const route = readFileSync(new URL("../../app/api/opiu/calendar-publish/route.ts", import.meta.url), "utf8");

test("календарная связь хранится в колонке и факт нельзя назначить двум планам", () => {
  assert.match(migration, /add column if not exists settled_by_payment_id uuid/);
  assert.match(migration, /foreign key \(settled_by_payment_id\) references public\.payments\(id\) on delete set null/);
  assert.match(migration, /create unique index if not exists payments_one_plan_per_fact_idx/);
  assert.match(migration, /having count\(\*\) = 1/);
});

test("удаление факта возвращает канонически связанный план в плановые", () => {
  assert.match(migration, /create trigger calendar_fact_unlink_status/);
  assert.match(migration, /new\.status := 'planned'/);
  assert.match(migration, /p\.settled_by_payment_id = p_payment_id/);
});

test("сервер подтверждения пишет каноническую связь вместе с меткой совместимости", () => {
  assert.match(route, /settled_by_payment_id: linked\.settledByPaymentId/);
  assert.match(route, /withCalendarFactLink/);
});

