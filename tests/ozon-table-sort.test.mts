import { strict as assert } from "node:assert";
import test from "node:test";
import { nextSortState, sortRows } from "../lib/ozon/tableSort";

test("клик по заголовку проходит три состояния и возвращает порядок сервера", () => {
  const first = nextSortState<"stock">(null, "stock");
  assert.deepEqual(first, { key: "stock", dir: "desc" });
  const second = nextSortState(first, "stock");
  assert.deepEqual(second, { key: "stock", dir: "asc" });
  assert.equal(nextSortState(second, "stock"), null, "третий клик снимает сортировку");
});

test("смена колонки начинает с убывания", () => {
  assert.deepEqual(nextSortState({ key: "stock" as const, dir: "asc" }, "orders"), { key: "orders", dir: "desc" });
});

test("нет данных всегда внизу, в обе стороны", () => {
  const rows = [{ id: "a", v: 5 }, { id: "b", v: null }, { id: "c", v: 1 }];
  const get = (row: { v: number | null }) => row.v;
  assert.deepEqual(sortRows(rows, { key: "v", dir: "desc" }, get).map((r) => r.id), ["a", "c", "b"]);
  assert.deepEqual(sortRows(rows, { key: "v", dir: "asc" }, get).map((r) => r.id), ["c", "a", "b"]);
});

test("без сортировки порядок сервера сохраняется как есть", () => {
  const rows = [{ id: "x" }, { id: "y" }];
  assert.equal(sortRows(rows, null, () => 0), rows, "массив не должен даже копироваться");
});

test("строки сравниваются по-русски", () => {
  const rows = [{ n: "Ёлка" }, { n: "Арбуз" }, { n: "Яблоко" }];
  assert.deepEqual(sortRows(rows, { key: "n", dir: "asc" }, (r) => r.n).map((r) => r.n), ["Арбуз", "Ёлка", "Яблоко"]);
});
