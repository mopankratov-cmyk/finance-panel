import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

import { applyCabinetOrder, CABINET_ORDER_STORAGE_KEY, moveCabinet, parseCabinetOrder } from "../lib/wb/cabinetOrder";

/**
 * Порядок кабинетов в переключателе «Кабинет данных». 04.10.2026: кабинеты
 * шли по дате подключения, и новый «ЗОРИ» оказался последним — под прокруткой.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const cab = (id: string) => ({ id, name: id.toUpperCase() });
const ids = (list: Array<{ id: string }>) => list.map((item) => item.id);

test("сохранённый порядок — первым, новые кабинеты — следом в серверном порядке", () => {
  const server = ["clerin", "cosmos", "retail", "optima", "sloeno", "zori"].map(cab);
  assert.deepEqual(ids(applyCabinetOrder(server, [])), ids(server), "без настройки — как отдал сервер");
  assert.deepEqual(
    ids(applyCabinetOrder(server, ["zori", "optima", "retail"])),
    ["zori", "optima", "retail", "clerin", "cosmos", "sloeno"],
  );
  // Отключённый кабинет и повтор в сохранённом списке ничего не ломают.
  assert.deepEqual(ids(applyCabinetOrder(server.slice(0, 3), ["gone", "retail", "retail", "clerin"])), ["retail", "clerin", "cosmos"]);
});

test("сдвиг — на одну позицию; с края двигать некуда", () => {
  const visible = ["a", "b", "c", "d"];
  assert.deepEqual(moveCabinet(visible, "c", "up"), ["a", "c", "b", "d"]);
  assert.deepEqual(moveCabinet(visible, "b", "down"), ["a", "c", "b", "d"]);
  assert.deepEqual(moveCabinet(visible, "a", "up"), visible);
  assert.deepEqual(moveCabinet(visible, "d", "down"), visible);
  assert.deepEqual(moveCabinet(visible, "x", "up"), visible);
  assert.deepEqual(visible, ["a", "b", "c", "d"], "исходный список не мутируется");
});

test("сохранённое значение: мусор — пустой порядок", () => {
  assert.deepEqual(parseCabinetOrder('["a","b"]'), ["a", "b"]);
  assert.deepEqual(parseCabinetOrder(null), []);
  assert.deepEqual(parseCabinetOrder("{не json"), []);
  assert.deepEqual(parseCabinetOrder('{"a":1}'), []);
  assert.deepEqual(parseCabinetOrder('["a", 5, "", null]'), ["a"]);
});

test("контекст отдаёт кабинеты в ручном порядке, переключатель умеет их двигать", () => {
  const context = read("../components/wb/WbCabinetContext.tsx");
  assert.match(context, /applyCabinetOrder\(serverCabinets, cabinetOrder\)/);
  assert.match(context, /localStorage\.getItem\(CABINET_ORDER_STORAGE_KEY\)/);
  assert.match(context, /localStorage\.setItem\(CABINET_ORDER_STORAGE_KEY, JSON\.stringify\(next\)\)/);
  assert.equal(CABINET_ORDER_STORAGE_KEY, "fp_cab_wb_order", "ключ не совпадает с ключом выбранного кабинета fp_cab_wb");

  const switcher = read("../components/wb/WbCabinetSwitcher.tsx");
  assert.match(switcher, /moveCabinet\(cabinet\.id, "up"\)/);
  assert.match(switcher, /moveCabinet\(cabinet\.id, "down"\)/);
  assert.match(switcher, /index === 0 \? "invisible" : ""/, "у первого стрелка вверх спрятана");
  assert.match(switcher, /index === cabinets\.length - 1 \? "invisible" : ""/, "у последнего стрелка вниз спрятана");
  assert.match(switcher, /!reordering && canUseAll/, "в режиме порядка «Все кабинеты» не мешается");
});
