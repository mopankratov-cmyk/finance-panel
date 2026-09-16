import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ctrIterationPlan } from "../lib/ctrtest/iterationPlan.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Фаза B методологии CTR-тестов (ТЗ владельца 15.09.2026): сколько итераций
 * теста влезает в сутки — на трафике ПРИВЯЗАННОЙ поисковой кампании, а не на
 * смешанном трафике товара (тот отдельно, `ctrTestForecast`). Часовых данных
 * WB не отдаёт — оценка на дневных средних, это предел, а не недосмотр.
 */

test("неизвестный суточный трафик — план не выдумывается", () => {
  const plan = ctrIterationPlan({ dailyViews: null, targetImpressions: 4000, variantCount: 2 });
  assert.equal(plan.iterationsPerDay, null);
  assert.equal(plan.feasible, null);
  assert.match(plan.text, /неизвестен/);
});

test("ноль трафика — то же самое, что null", () => {
  const plan = ctrIterationPlan({ dailyViews: 0, targetImpressions: 4000, variantCount: 2 });
  assert.equal(plan.iterationsPerDay, null);
  assert.equal(plan.feasible, null);
});

test("пример из ТЗ: 2 фото по 4000 — одна итерация 8000 показов", () => {
  const plan = ctrIterationPlan({ dailyViews: 16000, targetImpressions: 4000, variantCount: 2 });
  assert.equal(plan.impressionsPerIteration, 8000);
  assert.equal(plan.iterationsPerDay, 2);
  assert.equal(plan.feasible, true);
});

test("трафика хватает впритык на одну итерацию, но не с запасом — feasible всё равно true", () => {
  const plan = ctrIterationPlan({ dailyViews: 8000, targetImpressions: 4000, variantCount: 2 });
  assert.equal(plan.feasible, true);
  assert.equal(plan.iterationsPerDay, 1);
});

test("трафика не хватает даже на одну итерацию — предупреждение с советом про ставку", () => {
  const plan = ctrIterationPlan({ dailyViews: 3000, targetImpressions: 4000, variantCount: 2 });
  assert.equal(plan.feasible, false);
  assert.ok(plan.iterationsPerDay! < 1);
  assert.match(plan.text, /не хватает/);
  assert.match(plan.text, /ставки/);
});

test("запас ~15% считается от одной итерации, не от дневного трафика", () => {
  const plan = ctrIterationPlan({ dailyViews: 1, targetImpressions: 1000, variantCount: 3 });
  assert.equal(plan.impressionsPerIteration, 3000);
  assert.equal(plan.recommendedPerDay, Math.round(3000 * 1.15));
});

test("роут campaign-forecast не пишет в ctr_tests — только резолюция для предпросмотра", () => {
  const route = read("../app/api/ctrtest/campaign-forecast/route.ts");
  assert.match(route, /resolveCtrSearchCampaign\(db, cabinetId, nmId, mode\)/);
  assert.doesNotMatch(route, /\.from\("ctr_tests"\)\.update/, "предпросмотр в мастере не должен резолвить и фиксировать кампанию раньше времени — это делает только ensureCtrTestCampaignBinding при первом start");
});

test("суточное среднее считается по дням с данными, а не по всему окну целиком", () => {
  const route = read("../app/api/ctrtest/campaign-forecast/route.ts");
  assert.match(route, /daysWithData/);
  assert.doesNotMatch(route, /totalViews \/ WINDOW_DAYS/, "иначе недавно запущенная кампания даёт заниженное суточное среднее");
});

test("мастер вызывает ctrIterationPlan только для типа ctr", () => {
  const wizard = read("../components/wb/ctr/CtrTestWizard.tsx");
  assert.match(wizard, /ctrIterationPlan\(/);
  assert.match(wizard, /type === "ctr" && selected\?\.nm/);
});
