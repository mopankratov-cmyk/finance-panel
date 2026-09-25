import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceAfterFailure,
  advanceAfterSuccess,
  initAccrualCursorState,
  MAX_DATE_ATTEMPTS,
  targetSyncDate,
} from "./accrualSyncCursor.ts";

test("a fresh cursor targets the backfill floor", () => {
  const state = initAccrualCursorState("2026-07-11");
  assert.equal(targetSyncDate(state, "2026-09-23"), "2026-07-11");
});

test("targetSyncDate never exceeds yesterday even if pendingDate has caught up past it", () => {
  const state = { backfillFloor: "2026-07-11", pendingDate: "2026-09-24", pendingAttempts: 0 };
  assert.equal(targetSyncDate(state, "2026-09-23"), "2026-09-23");
});

test("advanceAfterSuccess moves the cursor exactly one day forward and resets attempts", () => {
  const state = { backfillFloor: "2026-07-11", pendingDate: "2026-07-11", pendingAttempts: 3 };
  const next = advanceAfterSuccess(state, "2026-07-11");
  assert.equal(next.pendingDate, "2026-07-12");
  assert.equal(next.pendingAttempts, 0);
});

test("a full backfill walk never skips a day, one success per day from floor to yesterday", () => {
  let state = initAccrualCursorState("2026-07-11");
  const yesterday = "2026-09-23";
  const syncedDates: string[] = [];
  for (let i = 0; i < 100; i += 1) {
    const date = targetSyncDate(state, yesterday);
    syncedDates.push(date);
    state = advanceAfterSuccess(state, date);
    if (date === yesterday) break;
  }
  // No duplicates, no gaps: every date from floor to yesterday appears exactly once, in order.
  for (let i = 1; i < syncedDates.length; i += 1) {
    const prev = Date.parse(`${syncedDates[i - 1]}T00:00:00.000Z`);
    const curr = Date.parse(`${syncedDates[i]}T00:00:00.000Z`);
    assert.equal(curr - prev, 86_400_000, `expected ${syncedDates[i]} to be exactly one day after ${syncedDates[i - 1]}`);
  }
  assert.equal(syncedDates[syncedDates.length - 1], yesterday);
});

test("once caught up, a missed cron window does not permanently lose any day (the C2 bug)", () => {
  // Catch the cursor up to "yesterday" as of an earlier moment in time.
  let state = initAccrualCursorState("2026-09-20");
  state = advanceAfterSuccess(state, targetSyncDate(state, "2026-09-23")); // syncs 09-20
  state = advanceAfterSuccess(state, targetSyncDate(state, "2026-09-23")); // syncs 09-21
  state = advanceAfterSuccess(state, targetSyncDate(state, "2026-09-23")); // syncs 09-22
  state = advanceAfterSuccess(state, targetSyncDate(state, "2026-09-23")); // syncs 09-23 (caught up)
  assert.equal(state.pendingDate, "2026-09-24");

  // Cron then doesn't run for a few days — "yesterday" is now much later.
  const laterYesterday = "2026-09-30";
  // Old buggy design would jump straight to laterYesterday here and never
  // revisit 09-24..09-29. The new cursor must walk through every one of them.
  const revisited: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const date = targetSyncDate(state, laterYesterday);
    revisited.push(date);
    state = advanceAfterSuccess(state, date);
    if (date === laterYesterday) break;
  }
  assert.deepEqual(revisited, [
    "2026-09-24",
    "2026-09-25",
    "2026-09-26",
    "2026-09-27",
    "2026-09-28",
    "2026-09-29",
    "2026-09-30",
  ]);
});

test("advanceAfterFailure increments attempts without moving the date, until it gives up", () => {
  let state = { backfillFloor: "2026-07-11", pendingDate: "2026-07-11", pendingAttempts: 0 };
  let gaveUp = false;
  for (let i = 1; i < MAX_DATE_ATTEMPTS; i += 1) {
    const result = advanceAfterFailure(state, "2026-07-11");
    state = result.state;
    gaveUp = result.gaveUp;
    assert.equal(state.pendingDate, "2026-07-11", `should not advance before attempt ${MAX_DATE_ATTEMPTS}`);
    assert.equal(state.pendingAttempts, i);
    assert.equal(gaveUp, false);
  }
  const final = advanceAfterFailure(state, "2026-07-11");
  assert.equal(final.gaveUp, true);
  assert.equal(final.state.pendingDate, "2026-07-12", "gives up and moves past the unreadable date");
  assert.equal(final.state.pendingAttempts, 0);
});
