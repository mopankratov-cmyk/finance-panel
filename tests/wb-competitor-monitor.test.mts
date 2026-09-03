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

test("полки и конкуренты — один раздел с переключателем", () => {
  const nav = read("../lib/wb/navigation.ts");
  assert.match(nav, /\{ label: "Полки \/ Цены", href: "\/wb\/shelf" \}/);
  assert.equal(/\/wb\/competitors/.test(nav), false, "отдельного пункта меню быть не должно");
});

test("вид конкурентов повторяет вёрстку полок", () => {
  // Один раздел — один язык: та же карточка-строка, то же фото, то же
  // раскрытие. Иначе при переключении приходится переучиваться.
  const view = read("../components/wb/WbCompetitorsView.tsx");
  const shelf = read("../components/wb/WbShelfPage.tsx");
  const marker = "h-16 w-[52px] shrink-0 rounded-lg bg-slate-100 object-cover ring-1 ring-slate-200/60";
  assert.ok(view.includes(marker), "фото товара как на полках");
  assert.ok(shelf.includes(marker), "полки не поменяли вёрстку");
  const title = "text-[17px] font-bold tracking-[-0.01em] text-slate-800";
  assert.ok(view.includes(title) && shelf.includes(title), "заголовок строки одинаковый");
});
