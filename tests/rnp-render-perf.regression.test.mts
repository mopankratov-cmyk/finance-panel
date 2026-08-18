import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

// Владелец пожаловался «сайт лагает». Сервер был здоров (API 0.6–1.3 с) — тормозил
// клиентский рендер РНП: лента рисовала ВСЕ карточки (метрики × дни × SKU —
// сотни тысяч элементов на каждый ввод), выключенные флагом блоки ассистента
// всё равно считались, а слушатель кликов шапки пересоздавался каждый рендер.

test("десктопная лента рендерится порциями, а не целиком", async () => {
  const page = await read("../components/wb/WbRnpPage.tsx");
  assert.match(page, /const deskSkus = tableSkus\.slice\(0, deskLimit\)/);
  assert.match(page, /\{deskSkus\.map\(\(sku\) => \{/);
  // Полная лента одним map — то самое, что душило страницу.
  assert.doesNotMatch(page, /\{tableSkus\.map\(\(sku\) => \{/);
  // Дорисовка по скроллу, а не кнопкой: поведение прежнее.
  assert.match(page, /new IntersectionObserver/);
  assert.match(page, /deskSentinelRef/);
});

test("выключенные флагом блоки ассистента не считаются", async () => {
  const page = await read("../components/wb/WbRnpPage.tsx");
  for (const call of [
    /SHOW_RNP_ASSISTANT_BLOCKS && activeData \? buildRnpFocusSummary/,
    /SHOW_RNP_ASSISTANT_BLOCKS && activeData\s*\n\s*\? buildRnpArticleCompare\(sortedSkus/,
    /SHOW_RNP_ASSISTANT_BLOCKS && activeData\s*\n\s*\? buildRnpArticleCompare\(selectedCompareSkus/,
  ]) {
    assert.match(page, call);
  }
  // Эффект выбора сравнения не должен коммитить новый массив с тем же составом.
  assert.match(page, /kept\.length === current\.length \? current : kept/);
});

test("слушатель кликов шапки вешается один раз", async () => {
  const toolbar = await read("../components/wb/RnpOperatingToolbar.tsx");
  assert.match(toolbar, /document\.addEventListener\("pointerdown", onPointerDown\);/);
  // Пустой массив зависимостей + актуальное замыкание в ref.
  assert.match(toolbar, /return \(\) => document\.removeEventListener\("pointerdown", onPointerDown\);\s*\n\s*\}, \[\]\);/);
  assert.match(toolbar, /closeAllRef\.current\(\)/);
});

test("мёртвая машинерия виртуализации убрана, а не оставлена вводить в заблуждение", async () => {
  const page = await read("../components/wb/WbRnpPage.tsx");
  for (const dead of ["skuWindow", "updateSkuWindow", "tableViewportRef", "visibleSkus"]) {
    assert.ok(!page.includes(dead), `в файле остался мёртвый ${dead}`);
  }
});
