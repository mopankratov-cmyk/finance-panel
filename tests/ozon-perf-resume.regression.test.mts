import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../lib/ozon/performance.ts", import.meta.url), "utf8");
const syncRoute = readFileSync(new URL("../app/api/sync/ozon-adverts/route.ts", import.meta.url), "utf8");

test("«отчёт от прошлого захода» определяется до создания нового", () => {
  // Флаг считался после того, как свежий UUID уже лёг в состояние, поэтому был
  // истиной всегда: любой батч опрашивался тремя попытками вместо заказанных
  // тридцати и доезжал только со следующего часа.
  const body = source.slice(source.indexOf("const loadBatch"), source.indexOf("const pollAttempts"));
  const resumedLine = body.slice(body.indexOf("const resumed"));
  assert.match(resumedLine.slice(0, 120), /const resumed = Boolean\(batchState\.uuid\);/);
  assert.ok(
    body.indexOf("const resumed") < body.indexOf("batchState.uuid = uuid"),
    "флаг должен вычисляться раньше присвоения нового UUID",
  );
});

test("зависший отчёт заказывается заново после нескольких заходов", () => {
  assert.match(source, /PERF_REPORT_MAX_WAITS/);
  assert.match(source, /batchState\.waited = \(batchState\.waited \?\? 0\) \+ 1/);
});

test("синк пишет состояние поверх живого, а не поверх снимка до старта", () => {
  assert.match(syncRoute, /let liveState/);
  // Ни одна запись состояния не должна разворачивать снимок, прочитанный
  // до начала захода: свежие UUID заказанных отчётов лежат именно в живом.
  assert.equal(syncRoute.includes("state: { ...(saved?.state ?? {})"), false);
});

test("сегодняшний день не попадает в историю по дням", () => {
  assert.match(syncRoute, /const historyOnly =/);
  assert.match(syncRoute, /row\.date < todayIso/);
  assert.equal(syncRoute.includes(".upsert(dailyRows,"), false, "в историю пишется только отфильтрованный набор");
});
