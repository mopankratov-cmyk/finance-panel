import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAttributeEdit,
  AttributeInputError,
  attributeRows,
  compareModels,
  isEditableKey,
  parseAttributeEdit,
  type Attributes,
} from "../lib/assortment/attributes.ts";
import { ACTIONS, availableActions, DecisionInputError, decisionReason, reasonLabel, STATUS_LABEL, type ReferenceStatus } from "../lib/assortment/decisions.ts";
import { buildEvidence, type EvidenceObservation } from "../lib/assortment/evidence.ts";

/**
 * Карточка модели и сравнение (этап 1.2, часть B). Происхождение признака,
 * причина отказа и честные «нет данных» ломаются тихо — их держат тесты.
 */

const NOW = "2026-10-02T09:00:00.000Z";

test("Ручная правка признака сохраняет исходное значение с сайта и сбрасывается к нему", () => {
  const published: Attributes = { colors: { value: ["Black", "Camel"], origin: "published" } };
  const edited = applyAttributeEdit(published, "colors", { kind: "set", value: "чёрный" }, "buyer@x", NOW);
  assert.equal(edited.colors.origin, "manual");
  assert.equal(edited.colors.value, "чёрный");
  assert.deepEqual(edited.colors.previous, { value: ["Black", "Camel"], origin: "published" });

  const again = applyAttributeEdit(edited, "colors", { kind: "set", value: "графит" }, "director@x", NOW);
  assert.deepEqual(again.colors.previous, { value: ["Black", "Camel"], origin: "published" }, "исходник не теряется после второй правки");

  const reset = applyAttributeEdit(again, "colors", { kind: "reset" }, "director@x", NOW);
  assert.deepEqual(reset.colors, { value: ["Black", "Camel"], origin: "published" });
  assert.equal(published.colors.origin, "published", "исходный объект не мутирует");
});

test("«Не видно» — отдельное состояние, а сброс ручного признака без исходника удаляет его", () => {
  const hidden = applyAttributeEdit({}, "hood", { kind: "not_visible" }, "buyer@x", NOW);
  assert.equal(hidden.hood.not_visible, true);
  const rows = attributeRows("jackets", hidden);
  const hood = rows.find((r) => r.key === "hood");
  assert.equal(hood?.value, "не видно");
  assert.equal(hood?.origin, "вручную");
  assert.deepEqual(applyAttributeEdit(hidden, "hood", { kind: "reset" }, "buyer@x", NOW), {});
});

test("В признаки не пишутся цены и деньги даже руками", () => {
  for (const value of ["450 €", "$120", "3 990 ₽", "цена ниже рынка", "200 руб", "cost 30"]) {
    assert.throws(() => parseAttributeEdit({ kind: "set", value }), AttributeInputError, value);
  }
  assert.deepEqual(parseAttributeEdit({ kind: "set", value: "  на  молнии " }), { kind: "set", value: "на молнии" });
  assert.deepEqual(parseAttributeEdit({ kind: "set", value: "   " }), { kind: "reset" });
  assert.throws(() => parseAttributeEdit({ kind: "set", value: "x".repeat(121) }), AttributeInputError);
});

test("Признаки раздела — по таблице ТЗ: у курток капюшон, у сумок способ ношения", () => {
  assert.equal(isEditableKey("jackets", "hood"), true);
  assert.equal(isEditableKey("bags", "hood"), false);
  assert.equal(isEditableKey("bags", "carry"), true);
  assert.equal(isEditableKey("bags", "price"), false);
  const labels = attributeRows("bags", {}).map((r) => r.label);
  assert.ok(labels.includes("Способ ношения") && labels.includes("Фурнитура"));
  assert.ok(labels.every((l) => !/цен|стоим|марж/i.test(l)));
});

test("Сравнение: общее и различия только по заполненным признакам", () => {
  const result = compareModels("bags", [
    { id: "a", name: "Polène", attributes: { silhouette: { value: "хобо", origin: "manual" }, closure: { value: "магнит", origin: "manual" }, texture: { value: "зернистая кожа", origin: "manual" } } },
    { id: "b", name: "JW PEI", attributes: { silhouette: { value: "Хобо", origin: "manual" }, closure: { value: "молния", origin: "manual" }, texture: { value: "", origin: "manual", not_visible: true } } },
    { id: "c", name: "Charles & Keith", attributes: { silhouette: { value: "полумесяц", origin: "manual" }, closure: { value: "поворотный замок", origin: "manual" } } },
  ]);
  assert.deepEqual(result.common, ["Силуэт: хобо — у 2 из 3"]);
  assert.deepEqual(result.differences, [
    "Силуэт: полумесяц — только у Charles & Keith",
    "Застёжка: магнит — только у Polène",
    "Застёжка: молния — только у JW PEI",
    "Застёжка: поворотный замок — только у Charles & Keith",
  ]);
  assert.ok(result.rows.every((row) => row.key !== "note"), "заметки в сравнение не идут");
  assert.ok(!result.common.concat(result.differences).some((line) => line.startsWith("Фактура")), "«не видно» и одиночное значение выводов не дают");
});

test("Решения: действия по статусу, отказ только с причиной", () => {
  assert.deepEqual(availableActions("rejected"), ["restore"]);
  assert.ok(availableActions("new").includes("rejected"));
  for (const status of Object.keys(STATUS_LABEL) as ReferenceStatus[]) {
    for (const action of availableActions(status)) assert.ok(ACTIONS[action], `${status} → ${action}`);
  }
  assert.throws(() => decisionReason("rejected", null, null), DecisionInputError);
  assert.throws(() => decisionReason("rejected", "other", "  "), DecisionInputError);
  assert.equal(decisionReason("rejected", "shape", ""), "shape");
  assert.equal(decisionReason("rejected", "shape", "слишком мягкая"), "shape:слишком мягкая");
  assert.equal(decisionReason("rejected", "other", "уже шьём похожую"), "other:уже шьём похожую");
  assert.equal(decisionReason("selected", "shape", ""), null);
  assert.equal(reasonLabel("shape:слишком мягкая"), "Не нравится форма — слишком мягкая");
  assert.equal(reasonLabel("other:уже шьём похожую"), "уже шьём похожую");
  assert.equal(reasonLabel("audience"), "Не наша аудитория");
});

const obs = (partial: Partial<EvidenceObservation>): EvidenceObservation => ({
  group_kind: "novelty", metric: "first_seen", value_text: "2026-10-01T10:00:00Z", value_num: null, null_reason: null,
  status: "observed", method: "import_url", region: null, source_url: "https://x.com/p", observed_at: "2026-10-01T10:00:00Z", ...partial,
});

test("Доказательства: недоступное — «нет данных» с причиной, а не пустота", () => {
  const evidence = buildEvidence([obs({})]);
  assert.equal(evidence.novelty[0].label, "Впервые у нас");
  assert.equal(evidence.novelty[0].value, "01.10.2026");
  assert.match(evidence.novelty[0].detail, /добавлено по ссылке · наблюдение системы/);
  assert.equal(evidence.novelty[1].value, "неизвестно");
  assert.ok(evidence.spread.every((row) => row.missing));
  assert.equal(evidence.retail[0].missing, true);

  const withBadge = buildEvidence([
    obs({}),
    obs({ metric: "published_at", value_text: "2026-09-12T10:00:00+02:00", status: "retailer_claim", method: "shopify_published_at" }),
    obs({ group_kind: "retail", metric: "new_badge", value_text: "New Arrival", status: "retailer_claim", method: "shopify_tags" }),
  ]);
  assert.equal(withBadge.novelty.length, 2);
  assert.equal(withBadge.novelty[1].value, "12.09.2026");
  assert.deepEqual(withBadge.retail.map((r) => [r.label, r.value, r.missing]), [["Метка ритейлера", "New Arrival", false]]);
});
