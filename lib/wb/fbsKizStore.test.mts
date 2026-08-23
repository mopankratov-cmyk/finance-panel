import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

// WB отдаёт код маркировки по одному заданию за запрос: на Оптиме это 673
// задания, из которых экран успевал проверить 120. Коды складывались в кэш
// Next — не общий между роутами и умирающий с каждой сборкой, поэтому
// прогресс терялся и опрос начинался почти с нуля.
test("коды маркировки хранятся в базе, а не в кэше сборки", async () => {
  const store = await read("./fbsKizStore.ts");
  assert.match(store, /from\("wb_fbs_order_kiz"\)/);
  assert.match(store, /export async function loadKnownKizCodes/);
  assert.match(store, /export async function rememberKizCodes/);
  // Пустой список не пишем: «кода нет» — состояние дня, а не факт.
  assert.match(store, /filter\(\(\[, codes\]\) => codes\.length > 0\)/);

  for (const path of ["../../app/api/supplies/kiz-reconcile/route.ts", "../../app/api/supplies/fbs-orders/route.ts"]) {
    const route = await read(path);
    assert.match(route, /loadKnownKizCodes/, `${path} не читает известные коды`);
    assert.match(route, /rememberKizCodes/, `${path} не запоминает найденные`);
    // Именно коды заданий через unstable_cache больше не идут.
    assert.doesNotMatch(route, /loadHourlyDashboard[\s\S]{0,80}wb-fbs-order-kiz/);
  }
});

test("бюджет запросов тратится только на неизвестные задания", async () => {
  const route = await read("../../app/api/supplies/fbs-orders/route.ts");
  // Задания с известным кодом отсеиваются ДО среза по бюджету.
  assert.match(route, /candidates\.filter\(\(row\) => !knownCodes\.get\(row\.id\)\?\.length\)\.slice\(0, META_BUDGET\)/);
});
