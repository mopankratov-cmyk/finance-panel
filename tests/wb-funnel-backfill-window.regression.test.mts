import assert from "node:assert/strict";
import test from "node:test";

import { FUNNEL_BACKFILL_DAYS, funnelGapRecoveryPeriod, syncFunnelPeriod } from "../lib/wb/funnelPeriod";

// Сверка с кабинетом 15.08.2026 по кабинету «Оптима — NORVIA/RIOBOX» показала:
// 12.08 и 14.08 сходились день в день, а 09.08 и 13.08 были меньше на 8-18% по
// всем SKU разом. Причина — WB дописывает воронку задним числом, а синк забирал
// ровно «вчера» и больше к этому дню не возвращался: проверка покрытия видит
// строку и считает день закрытым, даже если число в ней заниженное.

const at = (iso: string) => new Date(`${iso}T09:00:00.000Z`).getTime();

test("обычный прогон забирает окно дозаписи, а не один вчерашний день", () => {
  const period = syncFunnelPeriod("https://app/api/sync/funnel", at("2026-08-15"));
  assert.equal(period.end, "2026-08-14");
  assert.equal(period.begin, "2026-08-12");
  assert.equal(period.mode, "recent");
});

test("окно дозаписи не длиннее лимита WB в семь дней", () => {
  assert.ok(FUNNEL_BACKFILL_DAYS >= 2, "одного дня недостаточно: WB дописывает данные позже");
  assert.ok(FUNNEL_BACKFILL_DAYS <= 7, "history принимает максимум 7 дней одним запросом");
});

test("ручной период и понедельничное восстановление не изменились", () => {
  assert.deepEqual(
    syncFunnelPeriod("https://app/api/sync/funnel?from=2026-08-09&to=2026-08-09", at("2026-08-15")),
    { begin: "2026-08-09", end: "2026-08-09", mode: "manual" },
  );
  // 17.08.2026 — понедельник: восстанавливаем неделю целиком.
  const monday = syncFunnelPeriod("https://app/api/sync/funnel", at("2026-08-17"));
  assert.equal(monday.mode, "7d-recovery");
  assert.equal(monday.begin, "2026-08-10");
  assert.equal(monday.end, "2026-08-16");
});

test("календарная дыра по-прежнему важнее окна дозаписи", () => {
  const closed = ["2026-08-08", "2026-08-09", "2026-08-10"];
  const fallback = syncFunnelPeriod("https://app/api/sync/funnel", at("2026-08-11"));
  // По 09.08 строки нет ни у одного SKU — синк должен пойти именно туда.
  const period = funnelGapRecoveryPeriod(
    closed,
    [1, 2],
    [
      { nm_id: 1, date: "2026-08-08" },
      { nm_id: 2, date: "2026-08-08" },
      { nm_id: 1, date: "2026-08-10" },
      { nm_id: 2, date: "2026-08-10" },
    ],
    fallback,
  );
  assert.equal(period.mode, "gap-recovery");
  assert.equal(period.begin, "2026-08-09");
});
