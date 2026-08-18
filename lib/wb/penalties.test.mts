import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyPenaltyReason,
  summarizePenalties,
  WB_PENALTY_GROUP_LABELS,
  type WbPenaltyGroup,
  type WbPenaltyRow,
} from "./penalties";

function row(group: WbPenaltyGroup, total: number, reason = ""): WbPenaltyRow {
  return {
    rrdId: 0,
    date: "2026-08-18",
    nmId: null,
    article: "",
    brand: null,
    reason,
    operation: "",
    penalty: total,
    deduction: 0,
    total,
    group,
  };
}

test("габариты ловятся по всем написаниям, включая «объем» без ё", () => {
  for (const reason of [
    "Штраф за неверные габариты упаковки",
    "Изменение РАЗМЕРА товара",
    "Корректировка объёма",
    "Корректировка объема",
  ]) {
    assert.equal(classifyPenaltyReason(reason), "dimensions", `ожидались габариты для «${reason}»`);
  }
});

test("замеры и контроль склада — своя группа", () => {
  assert.equal(classifyPenaltyReason("Замер товара на складе"), "measurement");
  assert.equal(classifyPenaltyReason("Перемер ВГХ"), "measurement");
  assert.equal(classifyPenaltyReason("Контроль качества поставки"), "measurement");
});

test("подмены, вложения, недостача и пересорт идут в одну группу", () => {
  for (const reason of ["Подмена товара", "Неверное вложение", "Недостача при приёмке", "Пересорт поставки"]) {
    assert.equal(classifyPenaltyReason(reason), "substitution", `ожидались подмены для «${reason}»`);
  }
});

test("незнакомая и пустая причина не выдумывают группу, а падают в «прочие»", () => {
  assert.equal(classifyPenaltyReason(""), "other");
  assert.equal(classifyPenaltyReason("Удержание по решению WB"), "other");
});

test("классификация не зависит от регистра", () => {
  assert.equal(classifyPenaltyReason("ГАБАРИТЫ"), "dimensions");
  assert.equal(classifyPenaltyReason("замер"), "measurement");
});

test("габариты важнее замеров, когда в тексте есть и то и другое", () => {
  // Порядок проверок — часть контракта: строку «замер габаритов» мы считаем
  // штрафом за габариты, и тест зафиксирует, если порядок случайно поменяют.
  assert.equal(classifyPenaltyReason("Замер габаритов на складе"), "dimensions");
});

test("сводка всегда отдаёт все четыре группы, даже пустые", () => {
  const summary = summarizePenalties([]);
  assert.deepEqual(summary.map((item) => item.group), ["dimensions", "measurement", "substitution", "other"]);
  assert.ok(summary.every((item) => item.amount === 0 && item.rows === 0));
  assert.equal(summary[0].label, WB_PENALTY_GROUP_LABELS.dimensions);
});

test("сводка складывает суммы и считает строки по своей группе", () => {
  const summary = summarizePenalties([
    row("dimensions", 100),
    row("dimensions", 50.5),
    row("substitution", 300),
    row("other", 7),
  ]);
  const byGroup = new Map(summary.map((item) => [item.group, item]));

  assert.equal(byGroup.get("dimensions")?.amount, 150.5);
  assert.equal(byGroup.get("dimensions")?.rows, 2);
  assert.equal(byGroup.get("measurement")?.rows, 0);
  assert.equal(byGroup.get("substitution")?.amount, 300);
  assert.equal(byGroup.get("other")?.amount, 7);
});

test("возврат удержания (отрицательная строка) уменьшает сумму, а не игнорируется", () => {
  const summary = summarizePenalties([row("dimensions", 100), row("dimensions", -100)]);
  const dimensions = summary.find((item) => item.group === "dimensions");
  assert.equal(dimensions?.amount, 0);
  assert.equal(dimensions?.rows, 2, "две строки должны остаться видимыми при нулевой сумме");
});

test("сумма всех групп равна сумме строк — выборка ничего не теряет по дороге", () => {
  const rows = [row("dimensions", 10), row("measurement", 20), row("substitution", 30), row("other", 40)];
  const total = summarizePenalties(rows).reduce((sum, item) => sum + item.amount, 0);
  assert.equal(total, rows.reduce((sum, item) => sum + item.total, 0));
});
