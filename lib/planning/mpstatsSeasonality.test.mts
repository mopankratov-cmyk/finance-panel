import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateMpstatsSeasonality,
  knownMpstatsSubjectId,
  mpstatsSeasonalityCap,
} from "./mpstatsSeasonality";

const recentActual = Array.from({ length: 7 }, (_, index) => ({
  date: `2026-07-${String(20 + index).padStart(2, "0")}`,
  real_sales: 100,
}));

test("предметы Optima сопоставляются с MPSTATS без отдельного запроса на каждый SKU", () => {
  assert.equal(knownMpstatsSubjectId("Ветровки"), 172);
  assert.equal(knownMpstatsSubjectId("Куртки женские"), 168);
  assert.equal(knownMpstatsSubjectId("Пеналы"), 311);
  assert.equal(knownMpstatsSubjectId("Неизвестный предмет"), null);
});

test("августовский пик пеналов ограничивается рабочим коэффициентом 3,0", () => {
  const result = calculateMpstatsSeasonality({
    subjectId: 311,
    subjectName: "Пеналы",
    targetYear: 2026,
    targetMonth: 8,
    currentDate: "2026-07-27",
    forecast: [
      ...recentActual,
      { date: "2026-08-01", yhat_sales: 451 },
      { date: "2026-08-02", yhat_sales: 451 },
    ],
  });

  assert.equal(result.rawFactor, 4.51);
  assert.equal(result.factor, 3);
  assert.equal(result.source, "mpstats-forecast");
  assert.match(result.note, /ограничен/);
});

test("обычные предметы ограничиваются пределом 2,5", () => {
  const result = calculateMpstatsSeasonality({
    subjectId: 168,
    subjectName: "Куртки",
    targetYear: 2026,
    targetMonth: 8,
    currentDate: "2026-07-27",
    forecast: [...recentActual, { date: "2026-08-01", yhat_sales: 312 }],
  });

  assert.equal(mpstatsSeasonalityCap(168, "Куртки"), 2.5);
  assert.equal(result.rawFactor, 3.12);
  assert.equal(result.factor, 2.5);
});

test("годовой профиль используется за пределами горизонта дневного прогноза", () => {
  const result = calculateMpstatsSeasonality({
    subjectId: 168,
    subjectName: "Куртки",
    targetYear: 2026,
    targetMonth: 9,
    currentDate: "2026-07-27",
    annual: [
      { date: "07-01", season_sales: -63.76 },
      { date: "09-01", season_sales: 51.35 },
    ],
  });

  assert.equal(result.source, "mpstats-annual");
  assert.equal(result.factor, 2.5);
  assert.ok(result.rawFactor > 4);
});

test("текущий месяц не получает сезонность повторно", () => {
  const result = calculateMpstatsSeasonality({
    subjectId: 172,
    subjectName: "Ветровки",
    targetYear: 2026,
    targetMonth: 7,
    currentDate: "2026-07-27",
    forecast: [...recentActual, { date: "2026-07-28", yhat_sales: 500 }],
  });

  assert.equal(result.factor, 1);
  assert.equal(result.rawFactor, 1);
  assert.equal(result.source, "current-period");
});
