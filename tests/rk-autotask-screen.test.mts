import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Панель заполняет задачи сама, а человек их правит. Если совет и решение
 * выглядят одинаково, непонятно, что уже решено, а с чем можно спорить — и
 * разбор расхождений теряет смысл ещё до того, как начнётся.
 */

test("совет алгоритма отличим от решения человека", () => {
  const page = read("../components/wb/WbRkJournalPage.tsx");
  // Совет — пунктиром и приглушённо, решение — заливкой.
  assert.match(page, /entry\.source === "auto"\s*\n\s*\? `w-\[80px\] border border-dashed border-violet-300/);
  // И причина совета видна при наведении: совет без основания принимают
  // вслепую или отвергают не глядя, и сверять потом нечего.
  assert.match(page, /Предложил алгоритм: \$\{entry\.suggestedReason\}/);
  // У переписанного совета видно, что предлагалось — там и есть расхождение.
  assert.match(page, /Алгоритм предлагал: \$\{entry\.suggestedNote\}/);
});

test("правка человека помечается, но предложение не затирает", () => {
  const route = read("../app/api/wb/rk-notes/route.ts");
  assert.match(route, /source: "human",/);
  // suggested_note в upsert не участвует — предложение переживает правку.
  const upsert = route.slice(route.indexOf('.upsert({'), route.indexOf('onConflict'));
  // Ищем ПРИСВАИВАНИЕ, а не упоминание: в комментарии рядом это поле названо
  // по имени, и проверка на подстроку ловила бы сам комментарий.
  assert.equal(/suggested_note\s*:/.test(upsert), false, "предложение алгоритма правкой не затирается");
  // И читается обратно, иначе сверять будет нечем.
  assert.match(route, /suggested_note, suggested_reason/);
});
