import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Артикулы конкурентов лежат в той же таблице отслеживания, что и наши
 * товары: так их подхватывает готовый сборщик, и второй писать не нужно.
 * Цена этого удобства — экран «Полок» обязан их отфильтровывать, иначе
 * 96 чужих карточек засоряют список наших.
 */

test("«Полки» показывают только наши товары", () => {
  for (const path of ["../app/api/shelf/table/route.ts", "../app/api/shelf/watch/route.ts"]) {
    assert.match(read(path), /watchQ = watchQ\.eq\("purpose", "shelf"\)/, path);
  }
});

test("средняя цена считается только по собранным конкурентам", () => {
  const route = read("../app/api/wb/competitors/route.ts");
  // Ноль за неснятого конкурента превратил бы среднюю в выдумку.
  assert.match(route, /\.filter\(\(p\): p is number => p != null && p > 0\)/);
  assert.match(route, /const average = known\.length \? Math\.round/);
  // И сколько ещё не собрано — говорим вслух.
  assert.match(route, /pending: competitors\.length - known\.length/);
});

test("мониторинг конкурентов — отдельный раздел, «Полки» остались", () => {
  const nav = read("../lib/wb/navigation.ts");
  assert.match(nav, /\{ label: "Полки", href: "\/wb\/shelf" \}/);
  assert.match(nav, /\{ label: "Мониторинг конкурентов", href: "\/wb\/competitors" \}/);
});
