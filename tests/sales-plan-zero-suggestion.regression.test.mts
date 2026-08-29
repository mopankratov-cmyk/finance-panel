import assert from "node:assert/strict";
import test from "node:test";
import {
  applySalesPlanSuggestion,
  buildSalesPlanSuggestion,
  emptySalesPlanMonths,
  type SalesPlanDocument,
  type SalesPlanRow,
} from "../lib/planning/salesPlan";

/**
 * Регрессия: «Предложить план → Заменить все» стирало вручную заполненный
 * месяц нулями, когда фактического спроса нет (Ozon-каталог отдавал только
 * остатки, без заказов). Автосохранение через 850 мс закрепляло потерю,
 * отката в интерфейсе нет.
 */
const MONTH = "08";

function planWithFilledMonth(value: number): SalesPlanDocument {
  const months = emptySalesPlanMonths(2026);
  months[MONTH] = Array.from({ length: months[MONTH].length }, () => value);
  const row: SalesPlanRow = {
    id: "sku-1",
    model: "CLR-007",
    modelName: "Сумка",
    variant: "CLR00711",
    color: "Бежевый",
    externalId: "101",
    price: 3_800,
    buyout: 50,
    adPct: 10,
    stock: 500,
    openingStocks: {},
    ffAllocatedStocks: {},
    marketplaceStocks: {},
    image: null,
    isNew: false,
    months,
  };
  return {
    schemaVersion: 1,
    marketplace: "ozon",
    cabinetId: "cabinet",
    year: 2026,
    version: 1,
    revision: 0,
    status: "draft",
    responsible: "",
    rows: [row],
    createdAt: "",
    updatedAt: "",
    approvedAt: null,
    approvedBy: null,
    submittedAt: null,
    submittedBy: null,
    returnedAt: null,
    returnedBy: null,
  } as SalesPlanDocument;
}

test("нулевое предложение не затирает заполненные вручную дни", () => {
  const plan = planWithFilledMonth(200);
  const before = [...plan.rows[0].months[MONTH]];
  // Базы нет вовсе — ровно случай Ozon без данных о спросе.
  const suggestion = buildSalesPlanSuggestion(plan, MONTH, {}, { replaceFilled: true });
  const applied = applySalesPlanSuggestion(plan, suggestion);

  assert.deepEqual(applied.rows[0].months[MONTH], before, "ручные значения должны остаться нетронутыми");
  assert.equal(suggestion.rows[0].changedCells, 0, "превью обязано показать «изменится 0 ячеек»");
});

test("осмысленное предложение по-прежнему заменяет ячейки", () => {
  const plan = planWithFilledMonth(200);
  const rowId = plan.rows[0].id;
  const suggestion = buildSalesPlanSuggestion(
    plan,
    MONTH,
    {
      [rowId]: {
        stock: 500,
        ordersWeek: 70,
        revenueWeek: 70_000,
        ordersMonth: 300,
        revenueMonth: 300_000,
        seasonalityFactor: 1,
        seasonalityRawFactor: 1,
        seasonalitySource: "",
        seasonalitySubject: "",
        seasonalityNote: "",
        demandFactor: 1,
      },
    },
    { replaceFilled: true },
  );
  const applied = applySalesPlanSuggestion(plan, suggestion);

  assert.equal(applied.rows[0].months[MONTH][0], 10, "70 заказов за неделю → 10 в день");
  assert.ok(suggestion.rows[0].changedCells > 0);
});

test("пустые дни заполняются даже рядом с ручными значениями", () => {
  const plan = planWithFilledMonth(0);
  plan.rows[0].months[MONTH][0] = 150;
  const rowId = plan.rows[0].id;
  const suggestion = buildSalesPlanSuggestion(
    plan,
    MONTH,
    {
      [rowId]: {
        stock: 500,
        ordersWeek: 14,
        revenueWeek: 14_000,
        ordersMonth: 60,
        revenueMonth: 60_000,
        seasonalityFactor: 1,
        seasonalityRawFactor: 1,
        seasonalitySource: "",
        seasonalitySubject: "",
        seasonalityNote: "",
        demandFactor: 1,
      },
    },
    { replaceFilled: false },
  );
  const applied = applySalesPlanSuggestion(plan, suggestion);

  assert.equal(applied.rows[0].months[MONTH][0], 150, "ручной день сохраняется");
  assert.equal(applied.rows[0].months[MONTH][1], 2, "пустой день получает предложение");
});
