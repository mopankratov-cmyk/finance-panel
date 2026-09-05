import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../components/wb/WbAdvertsPage.tsx", import.meta.url), "utf8");

/**
 * Наложение строк в списке кампаний 05.09.2026.
 *
 * Высота жила в ДВУХ местах: константа ROW_HEIGHT для распорок виртуального
 * списка и класс `h-[76px]` в разметке строки. Когда строку переложили в три
 * уровня, содержимое выросло до 82px, не тронув ни одно из этих чисел, а
 * строка не обрезалась — и семь пикселей имени кампании ложились поверх
 * соседней строки.
 *
 * Сторож держит два условия: высота задаётся из одной константы и строка
 * обрезает себя сама, если снова перерастёт.
 */

test("высота строки берётся из ROW_HEIGHT, а не пишется классом", () => {
  assert.match(source, /style=\{\{ height: ROW_HEIGHT \}\}/, "строка обязана брать высоту из константы");
  assert.doesNotMatch(
    source,
    /className=\{`flex h-\[\d+px\] items-center border-b border-slate-100/,
    "высота строки классом — то самое второе место, из-за которого числа разъехались",
  );
});

test("строка обрезает себя, а не наезжает на соседнюю", () => {
  const row = source.slice(source.indexOf("style={{ height: ROW_HEIGHT }}"));
  const className = row.slice(0, row.indexOf("</div>"));
  assert.match(className, /overflow-hidden/, "без обрезки перерост снова уедет на соседа");
});

test("уровни строки не переносятся: перенос растит высоту", () => {
  // Перенос был лекарством от выезда за край и стал причиной перероста.
  const listRow = source.slice(source.indexOf("style={{ height: ROW_HEIGHT }}"), source.indexOf("<ChevronRight"));
  assert.doesNotMatch(listRow, /flex flex-wrap items-center gap-x-1\.5/);
  assert.doesNotMatch(listRow, /flex flex-wrap items-center gap-1 text-\[9px\]/);
});
