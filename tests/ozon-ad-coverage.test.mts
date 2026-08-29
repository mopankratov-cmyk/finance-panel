import { strict as assert } from "node:assert";
import test from "node:test";
import { chooseOzonAdSource, ozonAdHistoryDays, describeOzonAdCoverage } from "../lib/ozon/adCoverage";

const base = {
  periodDays: 14,
  endsToday: true,
  coveredDays: 0,
  dailyHasSpend: false,
  windowAvailable: false,
  windowHasSpend: false,
};

test("сегодняшний день не считается собираемым — он ещё идёт", () => {
  assert.equal(ozonAdHistoryDays(14, true), 13);
  assert.equal(ozonAdHistoryDays(14, false), 14);
  assert.equal(ozonAdHistoryDays(1, true), 0, "период «Сегодня» историей не покрывается вовсе");
});

test("полная история побеждает окно", () => {
  const result = chooseOzonAdSource({ ...base, coveredDays: 13, dailyHasSpend: true, windowAvailable: true, windowHasSpend: true });
  assert.deepEqual(result, { source: "daily", complete: true });
});

test("тонкая история не подменяет полное окно", () => {
  // Ровно случай, который дважды обнулял рекламу на проде: собрано 2 дня из 13,
  // при этом окно «последние 14 дней» держит полный расход.
  const result = chooseOzonAdSource({ ...base, coveredDays: 2, dailyHasSpend: true, windowAvailable: true, windowHasSpend: true });
  assert.deepEqual(result, { source: "window", complete: true });
});

test("без окна частичная история отдаётся, но помечается неполной", () => {
  const result = chooseOzonAdSource({ ...base, coveredDays: 5, dailyHasSpend: true });
  assert.deepEqual(result, { source: "daily", complete: false });
});

test("пресет «Сегодня» без окна честно говорит «не собрано», а не ноль", () => {
  const result = chooseOzonAdSource({ ...base, periodDays: 1 });
  assert.deepEqual(result, { source: "none", complete: false });
  assert.match(
    describeOzonAdCoverage({ clientId: "1", cabinet: "Ozon", periodDays: 1, historyDays: 0, coveredDays: 0, ...result }),
    /завтра/,
  );
});

test("прошлый период без истории не берёт окно: это другой отрезок времени", () => {
  const result = chooseOzonAdSource({ ...base, endsToday: false, windowAvailable: true, windowHasSpend: true });
  assert.equal(result.source, "none");
});

test("собранные дни без расхода — это факт «реклама не крутилась»", () => {
  const result = chooseOzonAdSource({ ...base, endsToday: false, coveredDays: 14, dailyHasSpend: false });
  assert.deepEqual(result, { source: "daily", complete: true });
});

test("подпись покрытия появляется только при неполноте", () => {
  const full = { clientId: "1", cabinet: "Ozon", periodDays: 14, historyDays: 13, coveredDays: 13, source: "daily" as const, complete: true };
  assert.equal(describeOzonAdCoverage(full), "");
  assert.match(describeOzonAdCoverage({ ...full, coveredDays: 9, complete: false }), /9 из 13/);
});
