import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * P1: форма графика кредита (`scheduleDraftFromRows`) собирает черновик ПО ДАТЕ,
 * а не по строке БД — `id` черновика это сама дата, и в payload PUT-запроса он
 * вообще не попадает (components/loans/LoansPage.tsx строит `rows` без `id`).
 * Из-за этого при любом ре-сейве графика (правка несвязанного поля, добавление
 * новой плановой строки) уже сверенные оплаченные/отменённые строки прилетают
 * на сервер обратно тем же телом запроса — без id, который позволил бы их
 * узнать. `removedPlanned.find` ищет совпадение только среди ПЛАНОВЫХ строк,
 * поэтому такая строка получала новый randomUUID и upsert вставлял её как
 * НОВУЮ — рядом с оригиналом из `keep`, который сервер и так не трогает.
 * Результат — график "распухал", в таблице удваивались уже закрытые строки.
 */

test("ре-сейв графика не дублирует уже оплаченные/отменённые строки", () => {
  const route = read("../app/api/finance/loans/schedule/route.ts");

  // Естественный ключ уже закрытых строк (дата+вид) собран из `keep` —
  // строк, которые PUT и так не трогает.
  assert.match(route, /const keepKeys = new Set\(keep\.map\(\(row\) => `\$\{row\.dueDate\}\|\$\{row\.kind\}`\)\);/);

  // Эхо уже закрытой строки отсеивается ДО того, как ей достанется randomUUID
  // и она уйдёт в incoming на upsert — иначе получится дубликат.
  const keepFilterIndex = route.indexOf("if (keepKeys.has(`${dueDate}|${kind}`)) return [];");
  assert.notEqual(keepFilterIndex, -1, "нет отсева эха уже закрытых строк по естественному ключу");
  const idAssignIndex = route.indexOf("id: reuse ? reuse.id : randomUUID(),");
  assert.notEqual(idAssignIndex, -1);
  assert.ok(keepFilterIndex < idAssignIndex, "отсев должен идти раньше присвоения нового id — иначе дубликат успеет попасть в incoming");

  // Отсев работает только против уже ЗАКРЫТЫХ строк (`keep` — не `planned`),
  // а не против всех существующих: новую строку, которую в форме сразу
  // отметили «Оплачено» вручную (легаси-путь без факта ДДС), это не должно
  // трогать — `keepKeys` не построен из `removedPlanned` или `existing`.
  assert.equal(/const keepKeys = new Set\(existing\.map/.test(route), false);
  assert.equal(/const keepKeys = new Set\(removedPlanned\.map/.test(route), false);
});
