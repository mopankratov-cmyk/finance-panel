import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

const rnp = readFileSync(new URL("../app/api/ozon/rnp/route.ts", import.meta.url), "utf8");
const cockpit = readFileSync(new URL("../lib/ozon/cockpit.ts", import.meta.url), "utf8");
const adSku = readFileSync(new URL("../app/api/ozon/ad-sku/route.ts", import.meta.url), "utf8");

/**
 * План-факт Ozon показывал пустую колонку рекламы ВСЕГДА: он искал скользящий
 * кэш «последние N дней» с N, равным длине месяца, а такой кэш существует
 * только для четырнадцати дней.
 */
test("план-факт берёт рекламу из истории по датам, а не из окна по числу дней", () => {
  // История читается общим постраничным читателем по конкретным датам.
  assert.match(rnp, /readOzonAdDaily\(/);
  assert.match(rnp, /dates\[0\],\s*\n?\s*dates\[dates\.length - 1\]/);
  assert.equal(
    /from\("ozon_ad_cache"\)[\s\S]{0,200}eq\("days", days\)/.test(rnp),
    false,
    "окно по числу дней для месячного периода не существует — колонка снова опустеет",
  );
});

test("расход в плане-факте раскладывается по дням, а не одним числом", () => {
  assert.match(rnp, /const adDaily = dates\.map\(\(d\) => Math\.round\(adByDay\.get\(d\) \?\? 0\)\)/);
  // Прежняя версия писала нули в дни и всю сумму в итог — график расхода был
  // плоским и бесполезным.
  assert.equal(/field: "ad"[\s\S]{0,120}daily: dates\.map\(\(\) => 0\)/.test(rnp), false);
});

test("служебные строки истории не попадают в разрез по товарам", () => {
  assert.match(rnp, /isOzonAdCabinetTotalSku\(row\.sku\)/);
  assert.match(rnp, /isOzonAdServiceSku\(row\.sku\)/);
});

test("экраны больше не заказывают отчёты Performance живьём", () => {
  // Заказ с экрана уходил в очередь Ozon и сжигал лимит «один отчёт в минуту»,
  // которым живёт ночная синхронизация, — а сам экран отчёта не дожидался.
  assert.equal(/perfProductReport\s*\(/.test(cockpit), false);
});

test("частичный отчёт не кладётся в кэш как полный", () => {
  assert.match(adSku, /rep\.partial\s*\n?\s*\?\s*\[\]/);
});
