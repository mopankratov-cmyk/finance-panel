import { strict as assert } from "node:assert";
import test from "node:test";
import { plural } from "../lib/warehouse/plural.ts";

const form = (n: number) => `${n} ${plural(n, "код просрочен", "кода просрочены", "кодов просрочены")}`;

test("единица и её хвосты", () => {
  assert.equal(form(1), "1 код просрочен");
  assert.equal(form(21), "21 код просрочен");
  assert.equal(form(101), "101 код просрочен");
});

test("двойка-четвёрка", () => {
  assert.equal(form(2), "2 кода просрочены");
  assert.equal(form(4), "4 кода просрочены");
  assert.equal(form(23), "23 кода просрочены");
});

test("пять и дальше", () => {
  assert.equal(form(5), "5 кодов просрочены");
  assert.equal(form(0), "0 кодов просрочены");
  assert.equal(form(100), "100 кодов просрочены");
});

test("одиннадцать — четырнадцать ломают правило хвоста", () => {
  assert.equal(form(11), "11 кодов просрочены");
  assert.equal(form(12), "12 кодов просрочены");
  assert.equal(form(14), "14 кодов просрочены");
  assert.equal(form(111), "111 кодов просрочены");
});
