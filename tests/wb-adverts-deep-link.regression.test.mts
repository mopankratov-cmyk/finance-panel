import assert from "node:assert/strict";
import test from "node:test";
import { decideCampaignSelection } from "../lib/adverts/campaignSelection";

/**
 * Ссылка на конкретную кампанию открывала не её.
 *
 * Проверено вживую 05.09.2026: адрес
 * /wb/adverts?cabinet=…&campaign=39112979&status=all открывал ESC00121
 * (38100188) — самую дорогую активную кампанию кабинета — и переписывал сам
 * себя на неё. Причина не в ссылке, а в том, что пустой список во время
 * двадцатисекундной загрузки читался как «нет такой кампании».
 */

test("пока список не приехал, выбор не трогаем", () => {
  const decision = decideCampaignSelection({ allIds: [], visibleIds: [], selectedId: 39112979 });
  assert.deepEqual(decision, { kind: "wait" });
});

test("кампания из ссылки остаётся выбранной, когда список приехал", () => {
  const decision = decideCampaignSelection({
    allIds: [38100188, 39112979],
    visibleIds: [38100188, 39112979],
    selectedId: 39112979,
  });
  assert.deepEqual(decision, { kind: "keep" });
});

test("кампания вне фильтра остаётся выбранной — она в кабинете есть", () => {
  const decision = decideCampaignSelection({
    allIds: [38100188, 39112979],
    visibleIds: [38100188],
    selectedId: 39112979,
  });
  assert.deepEqual(decision, { kind: "keep" }, "фильтр «Активные» не отменяет выбор паузной кампании");
});

test("без выбора открывается первая строка текущего фильтра", () => {
  const decision = decideCampaignSelection({
    allIds: [38100188, 39112979],
    visibleIds: [39112979, 38100188],
    selectedId: null,
  });
  assert.deepEqual(decision, { kind: "select", campaignId: 39112979 });
});

test("названной кампании в кабинете нет — снимаем выбор, а не подставляем соседнюю", () => {
  const decision = decideCampaignSelection({
    allIds: [38100188],
    visibleIds: [38100188],
    selectedId: 39112979,
  });
  assert.deepEqual(decision, { kind: "clear" });
});
