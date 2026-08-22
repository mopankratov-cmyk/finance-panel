import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hook = readFileSync(new URL("../components/wb/useRnpTags.tsx", import.meta.url), "utf8");
const funnel = readFileSync(new URL("../components/wb/WbFunnelPage.tsx", import.meta.url), "utf8");
const shelf = readFileSync(new URL("../components/wb/WbShelfPage.tsx", import.meta.url), "utf8");

test("ярлыки РНП работают в Воронке и Полках", () => {
  // Запрос владельца: ярлык на модели → все цвета модели одним фильтром.
  assert.match(funnel, /useRnpTags\(cabinetId\)/);
  assert.match(funnel, /nmMatchesTags\(tagIdsByNm, sku\.nm, activeTagIds\)/);
  assert.match(shelf, /useRnpTags\(hasExactCabinet \? cabinetId : null\)/);
  assert.match(shelf, /nmMatchesTags\(tagIdsByNm, item\.watch\.nmId, activeTagIds\)/);
  // Смена кабинета сбрасывает фильтр: id ярлыков другого кабинета — другие.
  assert.match(funnel, /useEffect\(\(\) => setActiveTagIds\(\[\]\), \[cabinetId\]\)/);
  assert.match(shelf, /useEffect\(\(\) => setActiveTagIds\(\[\]\), \[cabinetId\]\)/);
});

test("сводка по ярлыку в Воронке считается из числителей, а не средних процентов", () => {
  // Среднее процентов по SKU врёт при разных объёмах: CTR группы — это
  // клики/показы всей группы. ДРР восстанавливается из drr×заказы на SKU.
  assert.match(funnel, /shows > 0 \? \(clicks \/ shows\) \* 100 : null/);
  assert.match(funnel, /openCard > 0 \? \(carts \/ openCard\) \* 100 : null/);
  assert.match(funnel, /ordersSum > 0 \? \(advert \/ ordersSum\) \* 100 : null/);
  assert.match(funnel, /Итого по ярлыку/);
  // Проценты по дням из суммы ячеек не собрать — там честный прочерк.
  assert.match(funnel, /currentMetric\.kind === "pct"/);
});

test("сводка Полок честна к выбранному ярлыку", () => {
  assert.match(shelf, /const withTop6 = taggedItems/);
  assert.match(shelf, /activeTagIds\.length \? "По ярлыку" : "В реестре"/);
});

test("ярлыки на чужих экранах — только чтение, недоступность не роняет экран", () => {
  assert.match(hook, /catch\(\(\) => \{\}\)/);
  assert.match(hook, /cabinetId === "all"\) return/);
  assert.doesNotMatch(hook, /method: "POST"/);
});
