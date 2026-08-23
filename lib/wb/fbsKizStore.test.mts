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
  // Отметка об опросе живёт отдельно от кода: пустой ответ — это «спрашивали
  // тогда-то», а не «кода нет».
  assert.match(store, /PROBE_COOLDOWN_MS/);
  assert.match(store, /recentlyProbed/);

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
  // Задания с известным кодом и недавно опрошенные отсеиваются ДО среза по бюджету.
  assert.match(route, /candidates\s*\n?\s*\.filter\(\(row\) => !knownCodes\.get\(row\.id\)\?\.length/);
  assert.match(route, /\.slice\(0, META_BUDGET\)/);
});

// Счётчик «проверено 120 из 598» не двигался: из опрошенных 120 заданий WB не
// вернул ни одного кода, отметка об опросе не сохранялась, и каждый заход
// тратил бюджет на те же самые задания.
test("бюджет не уходит на повторный опрос одних и тех же заданий", async () => {
  const route = await read("../../app/api/supplies/fbs-orders/route.ts");
  assert.match(route, /!kizSnapshot\.recentlyProbed\.has\(row\.id\)/);
  // Пустой ответ пишется как отметка опроса.
  assert.match(route, /discovered\.set\(orderId, code \? \[code\] : \[\]\)/);

  const reconcile = await read("../../app/api/supplies/kiz-reconcile/route.ts");
  assert.match(reconcile, /discovered\.set\(id, codes\)/);
});
