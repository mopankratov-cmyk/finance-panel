import assert from "node:assert/strict";
import test from "node:test";

import { METRIC_GROUPS } from "../components/wb/RnpOperatingToolbar";
import { RNP_METRIC_FIELDS } from "../lib/rnp/operatingMatrix";

// Каталог метрик рос девять релизов подряд, а группы пикера остались от первой
// версии: заголовок писал «выбрано 9 из 52», а выбрать можно было только 18.
// Метрика, которой нет в пикере, доступна лишь через готовое отображение —
// для пользователя это выглядит как пропавшие данные.
test("в пикере показателей есть каждая метрика каталога", () => {
  const inPicker = new Set(METRIC_GROUPS.flatMap((group) => group.fields));
  const missing = RNP_METRIC_FIELDS.filter((field) => !inPicker.has(field));
  assert.deepEqual(missing, [], `не попали в пикер: ${missing.join(", ")}`);
});

test("пикер не показывает метрик, которых нет в каталоге", () => {
  const catalog = new Set<string>(RNP_METRIC_FIELDS);
  const unknown = METRIC_GROUPS.flatMap((group) => group.fields).filter((field) => !catalog.has(field));
  assert.deepEqual(unknown, [], `лишние поля: ${unknown.join(", ")}`);
});

test("каждая метрика лежит ровно в одной группе пикера", () => {
  const seen = new Map<string, number>();
  for (const group of METRIC_GROUPS) {
    for (const field of group.fields) seen.set(field, (seen.get(field) ?? 0) + 1);
  }
  const duplicated = [...seen.entries()].filter(([, count]) => count > 1).map(([field]) => field);
  assert.deepEqual(duplicated, [], `дубли: ${duplicated.join(", ")}`);
});
