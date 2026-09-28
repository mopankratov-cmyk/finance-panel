import assert from "node:assert/strict";
import test from "node:test";
import { buildOzonOpiuReport } from "./opiuOzonReport.ts";

function baseInput(overrides: Partial<Parameters<typeof buildOzonOpiuReport>[0]> = {}) {
  return {
    accrualRows: [],
    postings: [],
    adSpend: 0,
    typeNames: new Map<number, string>(),
    knownTypeIds: new Set<number>(),
    ...overrides,
  };
}

test("an empty period (no postings, no accruals) reports all-zero sections, not an error", () => {
  const report = buildOzonOpiuReport(baseInput());
  assert.equal(report.total, 0);
  const cogs = report.sections.find((s) => s.key === "cogs")!;
  assert.equal(cogs.kind, "stub");
  assert.equal(cogs.amount, null);
  for (const section of report.sections) {
    if (section.key === "cogs") continue;
    assert.equal(section.amount, 0, `expected ${section.key} to be 0`);
  }
});

test("type_id 69 on a POSTING row is always commission, never logistics", () => {
  const report = buildOzonOpiuReport(
    baseInput({ accrualRows: [{ accrued_category: "POSTING", type_id: 69, amount: -533 }] }),
  );
  const commission = report.sections.find((s) => s.key === "commission")!;
  const logistics = report.sections.find((s) => s.key === "logistics")!;
  assert.equal(commission.amount, -533);
  assert.equal(logistics.amount, 0);
});

test("any other POSTING type_id is logistics, with a per-type_id child row", () => {
  const report = buildOzonOpiuReport(
    baseInput({
      accrualRows: [
        { accrued_category: "POSTING", type_id: 32, amount: -56 },
        { accrued_category: "POSTING", type_id: 29, amount: -8.14 },
      ],
      typeNames: new Map([[32, "Последняя миля"]]),
    }),
  );
  const logistics = report.sections.find((s) => s.key === "logistics")!;
  assert.equal(logistics.amount, -64.14);
  assert.equal(logistics.children.length, 2);
  const known = logistics.children.find((c) => c.label === "Последняя миля")!;
  assert.equal(known.amount, -56);
  const unknown = logistics.children.find((c) => c.label === "Категория #29")!;
  assert.equal(unknown.amount, -8.14);
});

test("ITEM and NON_ITEM rows both land in Прочие удержания, neither one dropping the other", () => {
  const report = buildOzonOpiuReport(
    baseInput({
      accrualRows: [
        { accrued_category: "ITEM", type_id: 1, amount: -4.13 },
        { accrued_category: "NON_ITEM", type_id: 12, amount: -547.8 },
      ],
    }),
  );
  const other = report.sections.find((s) => s.key === "other")!;
  assert.equal(other.amount, -551.93);
  assert.equal(other.children.length, 2);
});

test("ad spend is a positive input but shows as a negative amount and subtracts from the total", () => {
  const report = buildOzonOpiuReport(baseInput({ adSpend: 281524 }));
  const ads = report.sections.find((s) => s.key === "ads")!;
  assert.equal(ads.amount, -281524);
  assert.equal(report.total, -281524);
});

test("orders section buckets posting amounts by stage", () => {
  const report = buildOzonOpiuReport(
    baseInput({
      postings: [
        { status: "delivered", amount: 1000 },
        { status: "cancelled", amount: 200 },
        { status: "delivering", amount: 50 },
      ],
    }),
  );
  const orders = report.sections.find((s) => s.key === "orders")!;
  assert.equal(orders.amount, 1250);
});

test("Продажи → Заказы comes from commission rows' extra.sale_amount, not from posting amounts (spec §7)", () => {
  const report = buildOzonOpiuReport(
    baseInput({
      postings: [{ status: "cancelled", amount: 200 }],
      accrualRows: [
        { accrued_category: "POSTING", type_id: 69, amount: -100, extra: { sale_amount: 1300 } },
        { accrued_category: "POSTING", type_id: 69, amount: -50, extra: { sale_amount: 700 } },
      ],
    }),
  );
  const sales = report.sections.find((s) => s.key === "sales")!;
  const ordersChild = sales.children.find((c) => c.label === "Заказы (оценка)")!;
  assert.equal(ordersChild.amount, 2000);
  assert.equal(sales.amount, 2000);
});

test("a commission row with no extra field contributes zero to Заказы without throwing", () => {
  const report = buildOzonOpiuReport(
    baseInput({ accrualRows: [{ accrued_category: "POSTING", type_id: 69, amount: -50 }] }),
  );
  const sales = report.sections.find((s) => s.key === "sales")!;
  const ordersChild = sales.children.find((c) => c.label === "Заказы (оценка)")!;
  assert.equal(ordersChild.amount, 0);
});

test("cancelled postings show as an informational Продажи child but never reduce Продажи or the total (finding C2)", () => {
  // The only revenue the total contains is Σ extra.sale_amount from
  // commission rows, which only exist for postings that actually accrued a
  // sale. A cancelled posting never gets one, so subtracting its
  // ozon_postings.amount from Продажи removed money the total never held —
  // real orders come out under-reported by roughly the value of every
  // cancellation in the period.
  const report = buildOzonOpiuReport(
    baseInput({
      postings: [{ status: "cancelled", amount: 500 }],
      accrualRows: [{ accrued_category: "POSTING", type_id: 69, amount: -10, extra: { sale_amount: 1000 } }],
    }),
  );
  const sales = report.sections.find((s) => s.key === "sales")!;
  assert.equal(sales.amount, 1000, "cancelled postings must not reduce Продажи");
  assert.equal(report.total, 1000 - 10, "cancelled postings must not reduce К выплате");
  const cancelledChild = sales.children.find((c) => c.label === "Возвраты и отмены (справочно)")!;
  assert.equal(cancelledChild.amount, -500, "still shown for visibility, just not summed in");
});

test("the top-level Заказы section is labelled to disambiguate it from Продажи → Заказы (finding I3)", () => {
  const report = buildOzonOpiuReport(baseInput({ postings: [{ status: "delivered", amount: 100 }] }));
  const orders = report.sections.find((s) => s.key === "orders")!;
  assert.equal(orders.label, "Заказы (по отправлениям)");
});

test("total sums Продажи + Комиссия + Логистика + Реклама + Прочие удержания, excluding Себестоимость", () => {
  const report = buildOzonOpiuReport(
    baseInput({
      accrualRows: [
        { accrued_category: "POSTING", type_id: 69, amount: -100, extra: { sale_amount: 1000 } },
        { accrued_category: "POSTING", type_id: 32, amount: -50 },
        { accrued_category: "NON_ITEM", type_id: 12, amount: -20 },
      ],
      adSpend: 30,
    }),
  );
  assert.equal(report.total, 1000 - 100 - 50 - 30 - 20);
});

test("a type_id absent from the cache is surfaced as a new category exactly once", () => {
  const report = buildOzonOpiuReport(
    baseInput({
      accrualRows: [
        { accrued_category: "POSTING", type_id: 32, amount: -10 },
        { accrued_category: "POSTING", type_id: 32, amount: -5 },
        { accrued_category: "NON_ITEM", type_id: 12, amount: -3 },
      ],
      knownTypeIds: new Set([32]),
    }),
  );
  assert.deepEqual(
    report.newCategories.map((c) => c.typeId),
    [12],
  );
});

test("an uncached logistics type_id is never flagged as new — the banner only ever names Прочие удержания (finding I4)", () => {
  // Spec §6 scopes the banner to Прочие удержания specifically ("внутри
  // «Прочие удержания» ... появился совсем новый type_id"). Logistics rows
  // are always correctly sectioned by the structural rule regardless of the
  // cache, so flagging them as "new" pointed the user at the wrong section.
  const report = buildOzonOpiuReport(
    baseInput({
      accrualRows: [{ accrued_category: "POSTING", type_id: 32, amount: -10 }],
      knownTypeIds: new Set([69]),
    }),
  );
  assert.deepEqual(report.newCategories, []);
});

test("an empty accrual-types cache flags nothing as new, rather than announcing every category as new (finding I4)", () => {
  // Before the migration is applied, before the first cron run, or while
  // Ozon is unreachable, ozon_accrual_types is empty. An empty cache is not
  // evidence any category is new — it just means there is nothing yet to
  // compare against.
  const report = buildOzonOpiuReport(
    baseInput({
      accrualRows: [{ accrued_category: "NON_ITEM", type_id: 12, amount: -3 }],
      knownTypeIds: new Set(),
    }),
  );
  assert.deepEqual(report.newCategories, []);
});

test("the same type_id under ITEM and under NON_ITEM contributes both amounts, neither one dropping the other", () => {
  // Nothing at the DB level stops the same numeric type_id from showing up
  // under two different accrued_category values — sumByType groups by
  // type_id alone once a row has been sorted into "other", so this pins that
  // both amounts still reach the total rather than the second write
  // silently overwriting the first.
  const report = buildOzonOpiuReport(
    baseInput({
      accrualRows: [
        { accrued_category: "ITEM", type_id: 12, amount: -10 },
        { accrued_category: "NON_ITEM", type_id: 12, amount: -5 },
      ],
    }),
  );
  const other = report.sections.find((s) => s.key === "other")!;
  assert.equal(other.amount, -15);
  assert.equal(other.children.length, 1);
  assert.equal(other.children[0].amount, -15);
});

test("the commission sentinel type_id never appears as a new category, even when uncached", () => {
  const report = buildOzonOpiuReport(
    baseInput({ accrualRows: [{ accrued_category: "POSTING", type_id: 69, amount: -100 }] }),
  );
  assert.deepEqual(report.newCategories, []);
});
