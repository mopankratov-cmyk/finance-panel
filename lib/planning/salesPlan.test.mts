import assert from "node:assert/strict";
import test from "node:test";
import {
  appendSalesPlanEvent,
  applySalesPlanSuggestion,
  buildSalesPlanSuggestion,
  canModerateSalesPlan,
  calculateSalesPlanDaily,
  calculateSalesPlanRowStockRisk,
  calculateSalesPlanRowMonth,
  calculateSalesPlanStockRiskSummary,
  createEmptySalesPlan,
  emptySalesPlanMonths,
  getApprovedSalesPlanForMonth,
  getSalesPlanMonthState,
  normalizeSalesPlanAction,
  normalizeSalesPlanEvents,
  normalizeSalesPlanMonthKey,
  normalizeSalesPlanReturnComment,
  setSalesPlanMonthState,
  type SalesPlanRow,
  validateSalesPlan,
  validateSalesPlanMonth,
  visibleSalesPlanMonths,
} from "./salesPlan";

function row(): SalesPlanRow {
  const months = emptySalesPlanMonths(2026);
  months["07"][0] = 8;
  return {
    id: "graphite",
    model: "NV-08-35",
    modelName: "Куртка демисезонная",
    variant: "NV-08-35-GRF",
    color: "Графит",
    externalId: "245813920",
    price: 13_500,
    buyout: 29,
    adPct: 12,
    stock: 10,
    image: null,
    isNew: false,
    months,
  };
}

test("реклама считается от заказной выручки до выкупа", () => {
  const daily = calculateSalesPlanDaily(row(), 8);
  assert.equal(daily.gross, 108_000);
  assert.equal(daily.ads, 12_960);
  assert.equal(daily.buyouts, 2);
});

test("месячные итоги используют заказы конкретного цвета", () => {
  const total = calculateSalesPlanRowMonth(row(), "07");
  assert.equal(total.orders, 8);
  assert.equal(total.ads, 12_960);
  assert.equal(total.revenue, 27_000);
});

test("остаток плана показывает конец месяца и первый день дефицита", () => {
  const current = row();
  current.stock = 2;
  current.buyout = 50;
  current.months["07"] = [1, 1, 3, 3];
  const safe = row();
  safe.id = "safe";
  safe.variant = "NV-08-35-BLK";
  safe.stock = 100;
  safe.buyout = 50;
  safe.months["07"] = [10, 10];
  const plan = createEmptySalesPlan({ marketplace: "wb", cabinetId: "cabinet", year: 2026 });
  plan.rows = [current, safe];

  const risk = calculateSalesPlanRowStockRisk(current, "07");
  assert.equal(risk.plannedOrders, 8);
  assert.equal(risk.plannedBuyouts, 4);
  assert.equal(risk.endingStock, -2);
  assert.equal(risk.shortageDay, 3);
  assert.equal(risk.shortageQty, 2);

  const summary = calculateSalesPlanStockRiskSummary(plan, "07");
  assert.equal(summary.currentStock, 102);
  assert.equal(summary.plannedOrders, 28);
  assert.equal(summary.plannedBuyouts, 14);
  assert.equal(summary.endingStock, 88);
  assert.equal(summary.shortageRows, 1);
  assert.equal(summary.shortageDay, 3);
});

test("остаток уменьшается на ожидаемые выкупы, а не на все заказы", () => {
  const current = row();
  current.stock = 1_030;
  current.buyout = 28;
  current.months["07"] = [228];

  const risk = calculateSalesPlanRowStockRisk(current, "07");
  assert.equal(risk.plannedOrders, 228);
  assert.equal(risk.plannedBuyouts, 64);
  assert.equal(risk.endingStock, 966);
  assert.equal(risk.shortageDay, null);
});

test("предложение плана заполняет пустые дни по факту 7 дней и не трогает ручные ячейки", () => {
  const current = row();
  current.stock = 100;
  current.months["07"] = [5, 0, 0, 2];
  const plan = createEmptySalesPlan({ marketplace: "wb", cabinetId: "cabinet", year: 2026 });
  plan.rows = [current];

  const suggestion = buildSalesPlanSuggestion(plan, "07", {
    [current.id]: {
      stock: 100,
      ordersWeek: 21,
      revenueWeek: 21_000,
      ordersMonth: 70,
      revenueMonth: 70_000,
      seasonalityFactor: 1,
      demandFactor: 1,
    },
  });

  assert.equal(suggestion.rows[0].dailyOrders, 3);
  assert.equal(suggestion.rows[0].currentOrders, 7);
  assert.equal(suggestion.rows[0].proposedDays[0], 5);
  assert.equal(suggestion.rows[0].proposedDays[1], 3);
  assert.equal(suggestion.rows[0].proposedDays[3], 2);
  assert.equal(suggestion.rows[0].proposedOrders, 94);
  assert.equal(suggestion.rows[0].endingStock, 73);
  assert.ok(suggestion.rows[0].warnings.includes("ручные ячейки сохранены"));

  const applied = applySalesPlanSuggestion(plan, suggestion);
  assert.deepEqual(applied.rows[0].months["07"].slice(0, 4), [5, 3, 3, 2]);
});

test("предложение показывает сырой MPSTATS-пик и применяет безопасный коэффициент", () => {
  const current = row();
  current.stock = 1_000;
  current.months["08"] = [0, 0];
  const plan = createEmptySalesPlan({ marketplace: "wb", cabinetId: "cabinet", year: 2026 });
  plan.rows = [current];

  const suggestion = buildSalesPlanSuggestion(plan, "08", {
    [current.id]: {
      stock: 1_000,
      ordersWeek: 70,
      revenueWeek: 21_000,
      ordersMonth: 200,
      revenueMonth: 70_000,
      seasonalityFactor: 3,
      seasonalityRawFactor: 4.51,
      seasonalitySource: "mpstats-forecast",
      seasonalitySubject: "Пеналы",
      seasonalityNote: "MPSTATS: дневной прогноз",
      demandFactor: 1,
    },
  });

  assert.equal(suggestion.rows[0].dailyOrders, 30);
  assert.equal(suggestion.rows[0].seasonalityRawFactor, 4.51);
  assert.equal(suggestion.rows[0].seasonalityFactor, 3);
  assert.equal(suggestion.rows[0].seasonalitySubject, "Пеналы");
  assert.ok(suggestion.rows[0].warnings.some((warning) => warning.includes("ограничен до 3")));
});

test("утверждение блокируется при дубле цвета и нулевой цене", () => {
  const plan = createEmptySalesPlan({ marketplace: "wb", cabinetId: "cabinet", year: 2026, responsible: "Анна" });
  const first = row();
  const duplicate = { ...row(), id: "duplicate", price: 0 };
  plan.rows = [first, duplicate];
  const issues = validateSalesPlan(plan);
  assert.ok(issues.some((issue) => issue.message.includes("Дубль вариации")));
  assert.ok(issues.some((issue) => issue.field === "price"));
});

test("пустой месяц нельзя отправить на согласование", () => {
  const plan = createEmptySalesPlan({ marketplace: "wb", cabinetId: "cabinet", year: 2026, responsible: "Анна" });
  plan.rows = [row()];

  assert.equal(validateSalesPlanMonth(plan, "07").length, 0);
  assert.ok(validateSalesPlanMonth(plan, "08").some((issue) => issue.field === "08.orders"));
});

test("план показывает все месяцы от текущего до конца года", () => {
  assert.deepEqual(visibleSalesPlanMonths(2026, 7), ["07", "08", "09", "10", "11", "12"]);
  assert.deepEqual(visibleSalesPlanMonths(2026, 11), ["11", "12"]);
  assert.deepEqual(visibleSalesPlanMonths(2026, 12), ["12"]);
});

test("права согласования плана работают fail-closed", () => {
  assert.equal(canModerateSalesPlan(null), false);
  assert.equal(canModerateSalesPlan(undefined), false);
  assert.equal(canModerateSalesPlan({ role: "manager" }), false);
  assert.equal(canModerateSalesPlan({ role: "director" }), true);
  assert.equal(canModerateSalesPlan({ role: "finance" }), true);
});

test("неизвестное действие плана не превращается в сохранение", () => {
  assert.equal(normalizeSalesPlanAction(undefined), "save");
  assert.equal(normalizeSalesPlanAction(""), "save");
  assert.equal(normalizeSalesPlanAction("submit"), "submit");
  assert.equal(normalizeSalesPlanAction("approve"), "approve");
  assert.equal(normalizeSalesPlanAction("approve-and-delete"), null);
  assert.equal(normalizeSalesPlanAction({ action: "approve" }), null);
});

test("комментарий возврата плана обязателен и нормализуется", () => {
  assert.equal(normalizeSalesPlanReturnComment(undefined), "");
  assert.equal(normalizeSalesPlanReturnComment("  "), "");
  assert.equal(normalizeSalesPlanReturnComment("ок"), "");
  assert.equal(normalizeSalesPlanReturnComment("  Цена   не заполнена  "), "Цена не заполнена");
});

test("согласование плана изолировано по месяцу", () => {
  const plan = createEmptySalesPlan({ marketplace: "wb", cabinetId: "cabinet", year: 2026, responsible: "Анна" });
  const submittedAugust = setSalesPlanMonthState(plan, "08", { status: "review", submittedAt: "2026-07-26T10:00:00.000Z", submittedBy: "manager@example.com" });
  const approvedAugust = setSalesPlanMonthState(submittedAugust, "08", { status: "approved", approvedAt: "2026-07-26T11:00:00.000Z", approvedBy: "director@example.com" });

  assert.equal(getSalesPlanMonthState(approvedAugust, "08").status, "approved");
  assert.equal(getSalesPlanMonthState(approvedAugust, "09").status, "draft");
  assert.equal(approvedAugust.status, "draft");
});

test("утверждённый план выбирается по конкретному месяцу", () => {
  const august = setSalesPlanMonthState(createEmptySalesPlan({ marketplace: "wb", cabinetId: "cabinet", year: 2026 }), "08", { status: "approved", approvedAt: "2026-07-26T11:00:00.000Z", approvedBy: "director@example.com" });
  const september = setSalesPlanMonthState(createEmptySalesPlan({ marketplace: "wb", cabinetId: "cabinet", year: 2026 }), "09", { status: "approved", approvedAt: "2026-07-27T11:00:00.000Z", approvedBy: "director@example.com" });

  const envelope = { working: september, approved: september, approvedByMonth: { "08": august, "09": september }, events: [] };
  assert.equal(getApprovedSalesPlanForMonth(envelope, "08"), august);
  assert.equal(getApprovedSalesPlanForMonth(envelope, "09"), september);
  assert.equal(getApprovedSalesPlanForMonth({ working: september, approved: september, approvedByMonth: {}, events: [] }, "08"), null);
  assert.equal(normalizeSalesPlanMonthKey("9"), "09");
});

test("новая версия месяца очищает метаданные утверждения только у этого месяца", () => {
  const approved = setSalesPlanMonthState(createEmptySalesPlan({ marketplace: "wb", cabinetId: "cabinet", year: 2026 }), "08", {
    status: "approved",
    approvedAt: "2026-07-26T11:00:00.000Z",
    approvedBy: "director@example.com",
    rnpSyncedAt: "2026-07-26T11:00:00.000Z",
  });
  const draft = setSalesPlanMonthState(approved, "08", {
    ...getSalesPlanMonthState(approved, "08"),
    status: "draft",
    version: 2,
    approvedAt: null,
    approvedBy: null,
    rnpSyncedAt: null,
  });

  assert.equal(getSalesPlanMonthState(draft, "08").status, "draft");
  assert.equal(getSalesPlanMonthState(draft, "08").approvedAt, null);
  assert.equal(getSalesPlanMonthState(draft, "08").approvedBy, null);
});

test("журнал событий плана нормализуется и дополняется append-only", () => {
  const existing = normalizeSalesPlanEvents([
    { id: "old", type: "submitted", at: "2026-07-26T10:00:00.000Z", actor: "manager@example.com", role: "manager", monthKey: "8", version: 1, revision: 2 },
    { type: "delete_everything", at: "2026-07-26T10:01:00.000Z", actor: "bad@example.com" },
  ]);
  const next = appendSalesPlanEvent(existing, {
    type: "returned",
    at: "2026-07-26T11:00:00.000Z",
    actor: "director@example.com",
    role: "director",
    monthKey: "08",
    version: 1,
    revision: 3,
    comment: "  Цена   не заполнена  ",
  });

  assert.equal(existing.length, 1);
  assert.equal(next.length, 2);
  assert.equal(next[0].id, "old");
  assert.equal(next[0].monthKey, "08");
  assert.equal(next[1].type, "returned");
  assert.equal(next[1].comment, "Цена не заполнена");
});
