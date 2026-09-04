import { strict as assert } from "node:assert";
import test from "node:test";
import { formatSince } from "../lib/warehouse/duration.ts";

const T0 = "2026-09-04T08:00:00Z";
const plus = (minutes: number) => new Date(Date.parse(T0) + minutes * 60_000).toISOString();

test("до часа — в минутах", () => {
  assert.equal(formatSince(T0, plus(25)), "через 25 мин");
  assert.equal(formatSince(T0, plus(59)), "через 59 мин");
});

test("от часа до двух суток — в часах", () => {
  assert.equal(formatSince(T0, plus(60)), "через 1 ч");
  assert.equal(formatSince(T0, plus(3 * 60)), "через 3 ч");
  assert.equal(formatSince(T0, plus(47 * 60)), "через 47 ч");
});

test("от двух суток — в днях", () => {
  assert.equal(formatSince(T0, plus(48 * 60)), "через 2 дн");
  assert.equal(formatSince(T0, plus(10 * 24 * 60)), "через 10 дн");
});

test("меньше минуты — «сразу»", () => {
  assert.equal(formatSince(T0, T0), "сразу");
  assert.equal(formatSince(T0, plus(0.4)), "сразу");
});

test("обратный порядок отметок — не длительность", () => {
  assert.equal(formatSince(plus(10), T0), null);
});

test("пустые и битые отметки дают null, а не NaN в ленте", () => {
  assert.equal(formatSince(null, T0), null);
  assert.equal(formatSince(T0, undefined), null);
  assert.equal(formatSince("", T0), null);
  assert.equal(formatSince("не дата", T0), null);
  assert.equal(formatSince(T0, "не дата"), null);
});
