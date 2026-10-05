import assert from "node:assert/strict";
import test from "node:test";
import { buildOzonOpiuReport } from "./opiuOzonReport.ts";
import {
  OZON_SHEET_ADS_EXTRA_TYPE_IDS,
  OZON_SHEET_ADS_LINES,
  OZON_SHEET_LOGISTICS_LINES,
  OZON_SHEET_LOGISTICS_NAMED_LINES,
  OZON_SHEET_OTHER_LINES,
} from "./opiuOzonSheetLayout.ts";

type Input = Parameters<typeof buildOzonOpiuReport>[0];

function baseInput(overrides: Partial<Input> = {}): Input {
  return { accrualRows: [], postings: [], typeNames: new Map<number, string>(), ...overrides };
}

const section = (report: ReturnType<typeof buildOzonOpiuReport>, key: string) =>
  report.sections.find((s) => s.key === key)!;
const child = (sec: { children: { label: string; amount: number | null }[] }, label: string) =>
  sec.children.find((c) => c.label === label)!;

test("an empty period reports zeros everywhere and keeps the stub sections as stubs", () => {
  const report = buildOzonOpiuReport(baseInput());
  assert.equal(report.total, 0);
  assert.equal(section(report, "cogs").kind, "stub");
  assert.equal(section(report, "cogs").amount, null);
  assert.equal(section(report, "warehouse").kind, "stub");
  for (const key of ["orders", "sales", "commission", "logistics", "ads", "other"]) {
    assert.equal(section(report, key).amount, 0, `${key} must be 0`);
  }
});

test("section headers use the exact labels of the reference sheet", () => {
  const report = buildOzonOpiuReport(baseInput());
  assert.deepEqual(
    report.sections.map((s) => s.label),
    [
      "Заказы",
      "Продажи",
      "Себестоимость",
      "Склад",
      "Комиссия за продажу:",
      "Логистика:",
      "Реклама:",
      "Прочие удержания:",
      "Прочие компенсации",
    ],
  );
  assert.equal(report.totalLabel, "ИТОГО К ВЫПЛАТЕ");
});

test("a real sale from the reference list: 250 sale, -50 commission, -9.64 last mile, -17.28 logistics → 173.08", () => {
  // Accrual 60413789942 from the sheet's «Список начислений» (Итоговая сумма операции = 173,08).
  const report = buildOzonOpiuReport(
    baseInput({
      accrualRows: [
        { accrual_id: 60413789942, accrued_category: "POSTING", type_id: 69, amount: -50, extra: { sale_amount: 250 } },
        { accrual_id: 60413789942, accrued_category: "POSTING", type_id: 29, amount: -9.64 },
        { accrual_id: 60413789942, accrued_category: "POSTING", type_id: 32, amount: -17.28 },
      ],
    }),
  );
  assert.equal(child(section(report, "sales"), "Заказы").amount, 250);
  assert.equal(section(report, "sales").amount, 250);
  assert.equal(section(report, "commission").amount, 50, "expense sections are shown positive, as in the sheet");
  assert.equal(section(report, "logistics").amount, 26.92);
  assert.equal(child(section(report, "logistics"), "Последняя миля").amount, -9.64, "logistics lines keep Ozon's sign");
  assert.equal(child(section(report, "logistics"), "Логистика").amount, -17.28);
  assert.equal(report.total, 173.08);
});

test("a return (negative sale_amount, no reversed services) goes to «Получение возврата, отмены, невыкупа от покупателя»", () => {
  const report = buildOzonOpiuReport(
    baseInput({
      accrualRows: [
        { accrual_id: 1, accrued_category: "POSTING", type_id: 69, amount: 50, extra: { sale_amount: -250 } },
      ],
    }),
  );
  const sales = section(report, "sales");
  assert.equal(child(sales, "Получение возврата, отмены, невыкупа от покупателя").amount, -250);
  assert.equal(child(sales, "Заказы").amount, 0);
  assert.equal(sales.amount, -250);
  assert.equal(section(report, "commission").amount, -50, "returned commission reduces the commission expense");
  assert.equal(report.total, -200);
});

test("a cancelled accrual (negative sale_amount with reversed positive services) goes to «Доставка покупателю — отмена начисления»", () => {
  // Accrual 60462387221 from the sheet: Итоговая сумма операции = -157,72.
  const report = buildOzonOpiuReport(
    baseInput({
      accrualRows: [
        { accrual_id: 60462387221, accrued_category: "POSTING", type_id: 69, amount: 50, extra: { sale_amount: -250 } },
        { accrual_id: 60462387221, accrued_category: "POSTING", type_id: 98, amount: 25 },
        { accrual_id: 60462387221, accrued_category: "POSTING", type_id: 32, amount: 17.28 },
      ],
    }),
  );
  const sales = section(report, "sales");
  assert.equal(child(sales, "Доставка покупателю — отмена начисления").amount, -250);
  assert.equal(child(sales, "Получение возврата, отмены, невыкупа от покупателя").amount, 0);
  assert.equal(report.total, -157.72);
});

test("an accrual with services only (no commission) adds nothing to Продажи but its services reach Логистика", () => {
  const report = buildOzonOpiuReport(
    baseInput({ accrualRows: [{ accrual_id: 5, accrued_category: "POSTING", type_id: 45, amount: -15 }] }),
  );
  const sales = section(report, "sales");
  assert.equal(sales.amount, 0);
  assert.equal(child(sales, "Доставка и обработка возврата, отмены, невыкупа").amount, 0);
  assert.equal(child(section(report, "logistics"), "Обработка возврата").amount, -15);
  assert.equal(section(report, "logistics").amount, 15);
});

test("Реклама lines are the sheet's accrual types, shown with the opposite sign, and the section sums them", () => {
  const report = buildOzonOpiuReport(
    baseInput({
      accrualRows: [
        { accrual_id: 1, accrued_category: "NON_ITEM", type_id: 41, amount: -152845 },
        { accrual_id: 2, accrued_category: "NON_ITEM", type_id: 54, amount: -30453 },
      ],
    }),
  );
  const ads = section(report, "ads");
  assert.equal(child(ads, "Оплата за клик").amount, 152845);
  assert.equal(child(ads, "Продвижение товара").amount, 30453);
  assert.equal(ads.amount, 183298);
  assert.equal(report.total, -183298);
});

test("every advertising line of the sheet is always shown, even at zero", () => {
  const ads = section(buildOzonOpiuReport(baseInput()), "ads");
  assert.deepEqual(
    ads.children.map((c) => c.label),
    OZON_SHEET_ADS_LINES.map((l) => l.label),
  );
});

test("an advertising type that is not in the sheet is shown as its own Реклама row once it has charges", () => {
  const report = buildOzonOpiuReport(
    baseInput({
      accrualRows: [{ accrual_id: 1, accrued_category: "NON_ITEM", type_id: 75, amount: -1000 }],
      typeNames: new Map([[75, "Трафареты"]]),
    }),
  );
  const ads = section(report, "ads");
  assert.equal(child(ads, "Трафареты").amount, 1000);
  assert.equal(ads.amount, 1000);
  assert.deepEqual(report.newCategories, [], "a known advertising type is not an unlisted category");
});

test("Прочие удержания lines keep Ozon's sign and the section is their sum with the opposite sign", () => {
  const report = buildOzonOpiuReport(
    baseInput({
      accrualRows: [
        { accrual_id: 1, accrued_category: "ITEM", type_id: 1, amount: -5271 },
        { accrual_id: 2, accrued_category: "NON_ITEM", type_id: 52, amount: -24990 },
      ],
    }),
  );
  const other = section(report, "other");
  assert.equal(child(other, "Эквайринг").amount, -5271);
  assert.equal(child(other, "Подписка Premium").amount, -24990);
  assert.equal(other.amount, 30261);
  assert.equal(report.total, -30261);
});

test("a charge type that is in none of the sheet's rows is still counted: NON_ITEM goes to Прочие удержания", () => {
  const report = buildOzonOpiuReport(
    baseInput({
      accrualRows: [{ accrual_id: 1, accrued_category: "NON_ITEM", type_id: 7, amount: -300 }],
      typeNames: new Map([[7, "Благотворительное пожертвование"]]),
    }),
  );
  assert.equal(child(section(report, "other"), "Благотворительное пожертвование").amount, -300);
  assert.equal(section(report, "other").amount, 300);
  assert.equal(report.total, -300);
  assert.deepEqual(report.newCategories, [
    { typeId: 7, label: "Благотворительное пожертвование", section: "other" },
  ]);
});

test("a posting service type that is in none of the sheet's rows is still counted: it goes to Логистика", () => {
  const report = buildOzonOpiuReport(
    baseInput({ accrualRows: [{ accrual_id: 1, accrued_category: "POSTING", type_id: 44, amount: -12 }] }),
  );
  assert.equal(child(section(report, "logistics"), "Категория #44").amount, -12);
  assert.equal(section(report, "logistics").amount, 12);
  assert.equal(report.newCategories[0].section, "logistics");
});

test("total follows the sheet's formula: Продажи − Комиссия − Логистика − Реклама − Прочие удержания", () => {
  const report = buildOzonOpiuReport(
    baseInput({
      accrualRows: [
        { accrual_id: 1, accrued_category: "POSTING", type_id: 69, amount: -100, extra: { sale_amount: 1000 } },
        { accrual_id: 1, accrued_category: "POSTING", type_id: 32, amount: -50 },
        { accrual_id: 2, accrued_category: "NON_ITEM", type_id: 41, amount: -30 },
        { accrual_id: 3, accrued_category: "NON_ITEM", type_id: 1, amount: -20 },
      ],
    }),
  );
  assert.equal(report.total, 1000 - 100 - 50 - 30 - 20);
});

test("the orders block sums the five statuses of the sheet and keeps unknown statuses visible", () => {
  const report = buildOzonOpiuReport(
    baseInput({
      postings: [
        { status: "delivered", amount: 1000 },
        { status: "cancelled", amount: 200 },
        { status: "delivering", amount: 50 },
        { status: "awaiting_deliver", amount: 10 },
        { status: "awaiting_packaging", amount: 5 },
        { status: "arbitration", amount: 7 },
      ],
    }),
  );
  const orders = section(report, "orders");
  assert.equal(child(orders, "Доставлено").amount, 1000);
  assert.equal(child(orders, "Отменено").amount, 200);
  assert.equal(child(orders, "Доставляется").amount, 50);
  assert.equal(child(orders, "Ожидает отгрузки").amount, 10);
  assert.equal(child(orders, "Ожидает упаковки").amount, 5);
  assert.equal(child(orders, "Другие статусы").amount, 7);
  assert.equal(orders.amount, 1272);
  assert.equal(report.total, 0, "orders are an informational block and never enter К выплате");
});

test("the «Другие статусы» row is absent when every posting has one of the five statuses", () => {
  const report = buildOzonOpiuReport(baseInput({ postings: [{ status: "delivered", amount: 1 }] }));
  assert.equal(section(report, "orders").children.some((c) => c.label === "Другие статусы"), false);
});

test("no float noise or negative zero in the output", () => {
  const report = buildOzonOpiuReport(
    baseInput({
      accrualRows: [
        { accrual_id: 1, accrued_category: "POSTING", type_id: 32, amount: -0.1 },
        { accrual_id: 2, accrued_category: "POSTING", type_id: 32, amount: -0.2 },
      ],
    }),
  );
  assert.equal(section(report, "logistics").amount, 0.3);
  assert.ok(Object.is(section(report, "commission").amount, 0), "must be +0, not -0");
});

test("every type_id is assigned to at most one line of the sheet layout", () => {
  const seen = new Map<number, string>();
  const lines = [
    ...OZON_SHEET_LOGISTICS_LINES.map((l) => ({ ...l, group: "logistics" })),
    ...OZON_SHEET_LOGISTICS_NAMED_LINES.map((l) => ({ ...l, group: "logistics-named" })),
    ...OZON_SHEET_ADS_LINES.map((l) => ({ ...l, group: "ads" })),
    ...OZON_SHEET_OTHER_LINES.map((l) => ({ ...l, group: "other" })),
  ];
  for (const line of lines) {
    for (const id of line.typeIds) {
      assert.equal(seen.has(id), false, `type ${id} is in both "${seen.get(id)}" and "${line.group}: ${line.label}"`);
      seen.set(id, `${line.group}: ${line.label}`);
    }
  }
  for (const id of OZON_SHEET_ADS_EXTRA_TYPE_IDS) {
    assert.equal(seen.has(id), false, `advertising extra type ${id} is already in "${seen.get(id)}"`);
  }
  assert.equal(seen.has(69), false, "69 is the commission, never a service line");
});
