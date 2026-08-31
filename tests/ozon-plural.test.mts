import { strict as assert } from "node:assert";
import test from "node:test";
import { cabinets, days, plural } from "../lib/ozon/plural";

test("формы слова выбираются по русским правилам", () => {
  assert.equal(days(1), "1 день");
  assert.equal(days(2), "2 дня");
  assert.equal(days(5), "5 дней");
  assert.equal(days(14), "14 дней", "11–14 всегда «дней», даже если оканчивается на 1-4");
  assert.equal(days(21), "21 день");
  assert.equal(days(22), "22 дня");
  assert.equal(days(92), "92 дня");
  assert.equal(days(111), "111 дней");
});

test("кабинеты склоняются так же", () => {
  assert.equal(cabinets(1), "1 кабинет");
  assert.equal(cabinets(3), "3 кабинета");
  assert.equal(cabinets(5), "5 кабинетов");
});

test("ноль и отрицательные не ломают правило", () => {
  assert.equal(days(0), "0 дней");
  assert.equal(plural(-2, "день", "дня", "дней"), "дня");
});
