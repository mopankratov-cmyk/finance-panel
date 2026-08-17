import assert from "node:assert/strict";
import test from "node:test";

import { buildReviewMetrics } from "../lib/rnp/buildTable";
import { RNP_METRIC_FIELDS } from "../lib/rnp/operatingMatrix";

// Отзывы в РНП: новые за день, рейтинг новых и доля плохих (1–3★) — из
// wb_feedbacks по дате создания отзыва на стороне WB.

const days = ["2026-08-15", "2026-08-16", "2026-08-17"];

test("день без отзывов — честный ноль, рейтинг и доля молчат", () => {
  const metrics = buildReviewMetrics(days, "2026-08-17", new Map([
    ["2026-08-15", { count: 4, ratingSum: 19, bad: 1 }],
  ]));
  const count = metrics.find((metric) => metric.field === "reviews_count");
  const rating = metrics.find((metric) => metric.field === "reviews_rating");
  const bad = metrics.find((metric) => metric.field === "reviews_bad_share_pct");
  assert.deepEqual(count?.daily, [4, 0, 0]);
  assert.equal(count?.total, 4);
  // 19/4 = 4.75; день без отзывов — null, а не ноль: нулевой рейтинг был бы враньём.
  assert.deepEqual(rating?.daily, [4.75, null, null]);
  assert.deepEqual(bad?.daily, [25, null, null]);
});

test("будущие дни периода остаются пустыми", () => {
  const metrics = buildReviewMetrics(days, "2026-08-16", new Map([
    ["2026-08-17", { count: 3, ratingSum: 15, bad: 0 }],
  ]));
  const count = metrics.find((metric) => metric.field === "reviews_count");
  assert.deepEqual(count?.daily, [0, 0, null]);
  // Отзыв после as_of не входит и в итог.
  assert.equal(count?.total, 0);
});

test("итоговый рейтинг взвешен количеством, а не средним по дням", () => {
  const metrics = buildReviewMetrics(days, "2026-08-17", new Map([
    ["2026-08-15", { count: 9, ratingSum: 45, bad: 0 }],
    ["2026-08-16", { count: 1, ratingSum: 1, bad: 1 }],
  ]));
  const rating = metrics.find((metric) => metric.field === "reviews_rating");
  // (45+1)/10 = 4.6, а не (5+1)/2 = 3.
  assert.equal(rating?.total, 4.6);
  assert.equal(metrics.find((metric) => metric.field === "reviews_bad_share_pct")?.total, 10);
});

test("поля отзывов зарегистрированы в каталоге", () => {
  for (const field of ["reviews_count", "reviews_rating", "reviews_bad_share_pct"]) {
    assert.ok((RNP_METRIC_FIELDS as readonly string[]).includes(field), `нет поля ${field}`);
  }
});
