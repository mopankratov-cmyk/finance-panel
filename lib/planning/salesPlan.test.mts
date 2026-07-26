import assert from "node:assert/strict";
import test from "node:test";
import {
  canModerateSalesPlan,
  calculateSalesPlanDaily,
  calculateSalesPlanRowMonth,
  createEmptySalesPlan,
  emptySalesPlanMonths,
  getApprovedSalesPlanForMonth,
  getSalesPlanMonthState,
  normalizeSalesPlanAction,
  normalizeSalesPlanMonthKey,
  normalizeSalesPlanReturnComment,
  setSalesPlanMonthState,
  type SalesPlanRow,
  validateSalesPlan,
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

test("утверждение блокируется при дубле цвета и нулевой цене", () => {
  const plan = createEmptySalesPlan({ marketplace: "wb", cabinetId: "cabinet", year: 2026, responsible: "Анна" });
  const first = row();
  const duplicate = { ...row(), id: "duplicate", price: 0 };
  plan.rows = [first, duplicate];
  const issues = validateSalesPlan(plan);
  assert.ok(issues.some((issue) => issue.message.includes("Дубль вариации")));
  assert.ok(issues.some((issue) => issue.field === "price"));
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

  const envelope = { working: september, approved: september, approvedByMonth: { "08": august, "09": september } };
  assert.equal(getApprovedSalesPlanForMonth(envelope, "08"), august);
  assert.equal(getApprovedSalesPlanForMonth(envelope, "09"), september);
  assert.equal(getApprovedSalesPlanForMonth({ working: september, approved: september, approvedByMonth: {} }, "08"), null);
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
