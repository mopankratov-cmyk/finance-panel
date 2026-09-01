import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Ночная чистка истории остатков падала четыре ночи подряд по statement
 * timeout — при том что удалять было НЕЧЕГО: строк старше 90 дней в таблице
 * нет. Валил её масштаб: 1,4 млн строк без индекса по snapshot_at, а
 * `count: "exact"` заставлял пересчитать всю таблицу.
 */

test("чистка идёт пачками и не пересчитывает таблицу", () => {
  const route = read("../app/api/sync/stocks-history-cleanup/route.ts");
  assert.match(route, /\.limit\(BATCH\)/);
  assert.match(route, /\.delete\(\)\.in\("id", ids\)/);
  assert.equal(
    /delete\(\{ count: "exact" \}\)/.test(route),
    false,
    "точный пересчёт таблицы ради числа удалённых убран",
  );
  // Бюджет времени меньше лимита платформы: лучше доложить о хвосте, чем быть
  // убитым на середине и не записать ничего.
  assert.match(route, /const DEADLINE_MS = 45_000;/);
  assert.match(route, /Date\.now\(\) - startedAt\.getTime\(\) > DEADLINE_MS/);
});

test("недоделанная чистка не выдаётся за успех", () => {
  const route = read("../app/api/sync/stocks-history-cleanup/route.ts");
  assert.match(route, /drained \? "ok" : "partial"/);
  assert.match(route, /Чистка не завершена/);
  // «partial» — законный статус журнала, а не опечатка.
  const helpers = read("../lib/sync/helpers.ts");
  assert.match(helpers, /status: "ok" \| "partial" \| "error",/);
  // И на экране он отличим от провала.
  const page = read("../components/sync/SyncPage.tsx");
  assert.match(page, /r\.status === "partial"/);
});

test("лимит WB — отложено, а не ошибка", () => {
  // Оптима ловит 429 по нескольку раз в сутки: это агентский кабинет на тысячи
  // кампаний, и лимит для него штатное состояние. Пока он писался ошибкой,
  // журнал был вечно красным, а настоящие сбои в нём терялись.
  const stocks = read("../app/api/sync/stocks/route.ts");
  assert.match(stocks, /if \(isWbGlobalRateLimitMessage\(message\)\) \{\s*\n\s*deferred\.push/);
  assert.match(stocks, /errors\.length \? "error" : deferred\.length \? "partial" : "ok"/);

  const fbs = read("../app/api/sync/fbs-orders/route.ts");
  assert.match(fbs, /const throttled = isWbGlobalRateLimitMessage\(message\);/);
  // Курсор не двигаем и попытки не накручиваем: attempts нужен для настоящих
  // отказов, от лимита он растёт сам собой и обесценивает сигнал.
  assert.match(fbs, /attempts: throttled \? \(saved\?\.attempts \?\? 0\) : \(saved\?\.attempts \?\? 0\) \+ 1,/);
  assert.match(fbs, /status: throttled \? "running" : "error",/);
  assert.match(fbs, /errors\.length \? "error" : deferred\.length \? "partial" : "ok"/);
});
