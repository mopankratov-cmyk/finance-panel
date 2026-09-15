import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Фаза D методологии CTR-тестов (ТЗ владельца 15.09.2026): ИИ-разбор фото по
 * итогам — вердикт по CTR каждого варианта + рекомендации на будущее.
 */

test("миграция объявляет колонки разбора", () => {
  const migration = read("../supabase/migrations/202609150005_ctr_test_ai_analysis.sql");
  assert.match(migration, /add column if not exists ai_analysis jsonb/);
  assert.match(migration, /add column if not exists ai_analysis_generated_at timestamptz/);
});

test("роут разбирает только CTR-тесты и требует минимум два варианта с показами", () => {
  const route = read("../app/api/ctrtest/[id]/analyze/route.ts");
  assert.match(route, /test\.test_type !== "ctr"/);
  assert.match(route, /withData\.length < 2/);
});

test("картинки передаются по URL, без скачивания — тот же приём, что уже отработан в lab/competitors", () => {
  const route = read("../app/api/ctrtest/[id]/analyze/route.ts");
  assert.match(route, /type: "image", source: \{ type: "url", url: variant\.image_url \}/);
  assert.doesNotMatch(route, /fetch\(variant\.image_url\)|readFile.*image_url/i, "не должен скачивать картинку на сервер перед отправкой");
});

test("результат сохраняется в ctr_tests, а не в отдельный журнал версий", () => {
  const route = read("../app/api/ctrtest/[id]/analyze/route.ts");
  assert.match(route, /\.from\("ctr_tests"\)\s*\n?\s*\.update\(\{ ai_analysis: analysis, ai_analysis_generated_at: generatedAt/);
});

test("вердикты по вариантам фильтруются по реально известным id — модель не может вписать чужой variantId", () => {
  const route = read("../app/api/ctrtest/[id]/analyze/route.ts");
  assert.match(route, /knownIds\.has\(Number\(v\.variantId\)\)/);
});

test("список тестов откатывается на три уровня полей при отсутствующих миграциях", () => {
  const route = read("../app/api/ctrtest/list/route.ts");
  assert.match(route, /AI_COLUMNS = "ai_analysis, ai_analysis_generated_at"/);
  assert.match(route, /withAll\.error\?\.code === "42703"/);
  assert.match(route, /withCampaign\.error\?\.code === "42703"/);
});

test("деталь теста показывает ИИ-разбор только для типа ctr", () => {
  const detail = read("../components/wb/ctr/CtrTestDetail.tsx");
  assert.match(detail, /test\.testType === "ctr" \? <CtrAiAnalysisPanel test=\{test\} \/> : null/);
});

test("кнопка разбора СКРЫТА (не дизейблена) меньше чем на двух вариантах с показами — согласовано с серверной проверкой", () => {
  const detail = read("../components/wb/ctr/CtrTestDetail.tsx");
  assert.match(detail, /test\.variants\.filter\(\(variant\) => variant\.impressions > 0\)\.length >= 2/);
  // Серая недоступная кнопка — то же самое обещание, что и её отсутствие, но
  // занимает место и переспрашивает клик, ничего не объясняя без наведения.
  const panel = detail.slice(detail.indexOf("function CtrAiAnalysisPanel"), detail.indexOf("export function CtrTestDetail"));
  assert.match(panel, /\{eligible \? \(/, "кнопка должна не рендериться вовсе, а не только дизейблиться");
  assert.doesNotMatch(panel, /disabled=\{busy \|\| !eligible\}/, "старый вариант с disabled по !eligible не должен вернуться");
});
