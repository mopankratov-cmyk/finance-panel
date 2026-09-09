import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { displayableItems, type ContentItem } from "../lib/content/productLibrary";

/**
 * Каталог контента и подборщик вариантов теста показывают ОДИН каталог с двух
 * экранов. Пока правило «что рисовать» было переписано в компоненте от руки,
 * разъехаться они могли молча: по одному товару два экрана показывали бы разное
 * число файлов, и оба выглядели бы сломанными, хотя данные одни.
 */

const item = (usability: ContentItem["usability"], key: string): ContentItem => ({
  key,
  url: "https://example.test/x.png",
  thumbUrl: "https://example.test/x.png",
  kind: "image",
  origin: "shoot",
  usability,
  label: key,
  isCover: false,
  frameIndex: null,
});

test("в сетку не попадает то, у чего нечего показать", () => {
  const items = [
    item("public", "годен"),
    item("panel-only", "только просмотр"),
    item("unresolved", "путь на Диске"),
    item("missing", "нет ссылки"),
  ];

  const shown = displayableItems(items);

  assert.deepEqual(shown.map((entry) => entry.key), ["годен", "только просмотр"]);
  assert.equal(
    items.length - shown.length,
    2,
    "скрытое обязано оставаться счётным: экран говорит о нём числом, а не молчит",
  );
});

test("правило скрытия живёт в одном месте, а не переписано в экранах", () => {
  // Дублировать фильтр в компонентах — это и есть тот способ разъехаться,
  // ради которого написан этот тест. Ловим повторное объявление по признаку:
  // сравнение usability с "unresolved" внутри фильтра компонента.
  for (const file of ["components/wb/ctr/ContentPicker.tsx", "components/wb/WbContentPage.tsx"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.ok(
      source.includes("displayableItems"),
      `${file} обязан звать displayableItems, а не фильтровать сам`,
    );
    assert.ok(
      !/filter\([^)]*usability\s*!==\s*"unresolved"/.test(source),
      `${file} снова фильтрует недоступное вручную — правило разъедется с соседним экраном`,
    );
  }
});
