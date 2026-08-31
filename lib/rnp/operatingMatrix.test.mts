import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateRnpWeekly,
  dayOverDayBaseline,
  detectDeclineStreakSignal,
  detectSkuAnomalies,
  detectSkuSignals,
  detectStockCoverageSignal,
  filterAnomaliesByField,
  formatAnomalyBadge,
  isOpenMoscowDayLabel,
  matchesArticleList,
  metricDelta,
  parseArticleList,
  previousEqualRange,
  sanitizeMetricFields,
} from "./operatingMatrix";

test("previous RNP comparison range has the same inclusive length", () => {
  assert.deepEqual(previousEqualRange("2026-07-01", "2026-07-31"), {
    from: "2026-05-31",
    to: "2026-06-30",
  });
  assert.deepEqual(previousEqualRange("2026-07-20", "2026-07-26"), {
    from: "2026-07-13",
    to: "2026-07-19",
  });
});

test("article list accepts lines, commas and WB ids without duplicates", () => {
  assert.deepEqual(parseArticleList("HT-80-11,\nESCO0124; 1244157 HT-80-11"), [
    "ht-80-11",
    "esco0124",
    "1244157",
  ]);
  assert.equal(matchesArticleList({ nm: 1244157, art: "HT-80-11", name: "Ветровка" }, "1244157\nOTHER"), true);
  assert.equal(matchesArticleList({ nm: 1, art: "HT-80-11", name: "Ветровка" }, "ESCO0124"), false);
});

test("saved metric configuration is restricted to known unique fields", () => {
  assert.deepEqual(sanitizeMetricFields(["orders_sum", "orders_sum", "hacked", "drr"]), ["orders_sum", "drr"]);
  assert.ok(sanitizeMetricFields(null).length > 0);
});

test("metric deltas preserve zero-base uncertainty", () => {
  assert.deepEqual(metricDelta(120, 100), { absolute: 20, percent: 20, direction: "up" });
  assert.deepEqual(metricDelta(20, 0), { absolute: 20, percent: null, direction: "up" });
  assert.equal(metricDelta(null, 10), null);
});

test("daily RNP deltas compare with the previous calendar day", () => {
  const current = [120, 150, 90];
  const previousPeriod = [70, 80, 100];
  assert.equal(dayOverDayBaseline(current, previousPeriod, 0), 100);
  assert.equal(dayOverDayBaseline(current, previousPeriod, 1), 120);
  assert.equal(dayOverDayBaseline(current, previousPeriod, 2), 150);
  assert.equal(dayOverDayBaseline(current, previousPeriod, 3), null);
});

test("an unfinished Moscow calendar day can be excluded from daily deltas", () => {
  const now = new Date("2026-07-26T21:30:00.000Z");
  assert.equal(isOpenMoscowDayLabel("27.07", now), true);
  assert.equal(isOpenMoscowDayLabel("26.07", now), false);
});

test("anomaly detector understands beneficial and harmful directions", () => {
  const previous = {
    nm: 1,
    art: "A",
    name: "A",
    metrics: [
      { field: "orders_sum", kind: "money", total: 100 },
      { field: "drr", kind: "pct", total: 20 },
    ],
  };
  const current = {
    nm: 1,
    art: "A",
    name: "A",
    metrics: [
      { field: "orders_sum", kind: "money", total: 60 },
      { field: "drr", kind: "pct", total: 27 },
    ],
  };

  assert.deepEqual(
    detectSkuAnomalies(current, previous).map((anomaly) => [anomaly.field, anomaly.direction]),
    [["orders_sum", "negative"], ["drr", "negative"]],
  );
});

// --- Детектор аномалий: пороги по метрикам, дефицит остатка, серии подряд ---

function sku(metrics: Array<{ field: string; kind: string; total: number | null; daily?: Array<number | null> }>) {
  return { nm: 1, art: "HT-80-02", name: "Ветровка", metrics };
}

test("порог берётся по конкретной метрике, а не общий на всё", () => {
  const current = sku([{ field: "drr", kind: "pct", total: 18 }]);
  const previous = sku([{ field: "drr", kind: "pct", total: 15 }]);
  // Отклонение 3 п.п.: при общем пороге 5 п.п. — не аномалия.
  assert.equal(detectSkuAnomalies(current, previous).length, 0);
  // Персональный порог 2 п.п. по ДРР — аномалия появляется.
  assert.equal(detectSkuAnomalies(current, previous, 30, 5, { drr: 2 }).length, 1);
});

test("персональный порог не меняет поведение остальных метрик", () => {
  const current = sku([{ field: "orders_count", kind: "count", total: 120 }]);
  const previous = sku([{ field: "orders_count", kind: "count", total: 100 }]);
  // +20% ниже дефолтного порога 30%.
  assert.equal(detectSkuAnomalies(current, previous, 30, 5, { drr: 2 }).length, 0);
  assert.equal(detectSkuAnomalies(current, previous, 30, 5, { orders_count: 15 }).length, 1);
});

test("дефицит остатка: сигнал, когда покрытия меньше порога дней", () => {
  const short = detectStockCoverageSignal(sku([{ field: "turnover", kind: "count", total: 1.4 }]), 7);
  assert.equal(short?.kind, "coverage");
  assert.equal(short?.days, 1);
  assert.equal(short?.direction, "negative");
  // Ровно на пороге и выше — не сигнал.
  assert.equal(detectStockCoverageSignal(sku([{ field: "turnover", kind: "count", total: 7 }]), 7), null);
  // Нет данных об оборачиваемости — молчим, а не считаем нулём.
  assert.equal(detectStockCoverageSignal(sku([{ field: "turnover", kind: "count", total: null }]), 7), null);
});

test("серия подряд: три дня падения — сигнал, два — нет", () => {
  const falling = sku([{ field: "orders_count", kind: "count", total: 10, daily: [50, 40, 30, 20] }]);
  const streak = detectDeclineStreakSignal(falling, "orders_count", 3);
  assert.equal(streak?.kind, "streak");
  assert.equal(streak?.days, 3);
  const shortFall = sku([{ field: "orders_count", kind: "count", total: 10, daily: [50, 50, 40, 30] }]);
  assert.equal(detectDeclineStreakSignal(shortFall, "orders_count", 3), null);
  // Разрыв ряда обрывает серию.
  const bumpy = sku([{ field: "orders_count", kind: "count", total: 10, daily: [10, 40, 30, 35] }]);
  assert.equal(detectDeclineStreakSignal(bumpy, "orders_count", 3), null);
});

test("пропуск в данных не считается падением", () => {
  const gap = sku([{ field: "orders_count", kind: "count", total: 10, daily: [50, null, 30, 20] }]);
  assert.equal(detectDeclineStreakSignal(gap, "orders_count", 3), null);
});

test("сводный набор сигналов не дублирует метрику отклонением и серией", () => {
  const current = sku([
    { field: "orders_count", kind: "count", total: 40, daily: [40, 30, 20, 10] },
    { field: "turnover", kind: "count", total: 2 },
  ]);
  const previous = sku([
    { field: "orders_count", kind: "count", total: 100, daily: [100, 100, 100, 100] },
    { field: "turnover", kind: "count", total: 30 },
  ]);
  const signals = detectSkuSignals(current, previous);
  const orderSignals = signals.filter((signal) => signal.field === "orders_count");
  assert.equal(orderSignals.length, 1);
  assert.equal(orderSignals[0].kind, "delta");
  assert.ok(signals.some((signal) => signal.kind === "coverage"));
});

test("фильтр по показателю оставляет только выбранную метрику", () => {
  const anomalies = [
    { field: "drr", label: "ДРР", direction: "negative" as const, delta: null, kind: "delta" as const },
    { field: "views", label: "Показы", direction: "negative" as const, delta: null, kind: "delta" as const },
  ];
  assert.equal(filterAnomaliesByField(anomalies, "all").length, 2);
  assert.deepEqual(filterAnomaliesByField(anomalies, "drr").map((item) => item.field), ["drr"]);
});

test("бейдж читается как у отраслевых кокпитов", () => {
  assert.equal(
    formatAnomalyBadge({
      field: "drr", label: "ДРР", direction: "negative", kind: "delta", metricKind: "pct",
      delta: { absolute: 57, percent: 380, direction: "up" },
    }),
    "ДРР +57 п.п.",
  );
  assert.equal(
    formatAnomalyBadge({
      field: "views", label: "Показы", direction: "negative", kind: "delta", metricKind: "count",
      delta: { absolute: -5800, percent: -58, direction: "down" },
    }),
    "показы −58%",
  );
  assert.equal(
    formatAnomalyBadge({ field: "stock", label: "Остаток", direction: "negative", delta: null, kind: "coverage", days: 1 }),
    "остаток ~1 дн",
  );
  assert.equal(
    formatAnomalyBadge({ field: "orders_count", label: "Заказы, шт", direction: "negative", delta: null, kind: "streak", days: 3 }),
    "заказы 3 дн",
  );
});

test("недельная колонка пересчитывает проценты из сумм, а не усредняет по дням", () => {
  // День с тремя заказами весил столько же, сколько день с тремястами:
  // средний CTR за неделю расходился с итогом за тот же период.
  const table = {
    period: Array.from({ length: 7 }, (_, index) => ({ label: `0${index + 1}.09`, period_type: "рабочий" })),
    summary: [
      { field: "clicks", kind: "int", daily: [10, 0, 0, 0, 0, 0, 90] },
      { field: "views", kind: "int", daily: [100, 0, 0, 0, 0, 0, 900] },
      { field: "ctr", kind: "pct", daily: [10, null, null, null, null, null, 10] },
      { field: "stock", kind: "int", daily: [50, 50, 48, 48, 45, 45, 40] },
    ],
    skus: [],
  };
  // 07.09.2026 — понедельник: неделя укладывается в одну колонку.
  const weekly = aggregateRnpWeekly(table, "2026-09-07", "2026-09-13");
  const find = (field: string) => weekly.summary.find((metric) => metric.field === field)!;
  assert.equal(find("ctr").daily[0], 10, "100 кликов на 1000 показов");
  assert.equal(find("clicks").daily[0], 100);
  // Остаток — снимок: сумма за неделю дала бы 326 штук вместо сорока.
  assert.equal(find("stock").daily[0], 40);
});
