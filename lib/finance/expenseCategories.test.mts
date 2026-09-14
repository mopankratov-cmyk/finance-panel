import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { categoryOptions, sectionForCategory, TRANSFER_CATEGORIES } from "./categories.ts";
import { validateExpenseCategory } from "./expenseCategories.ts";
import { aggregateDdsMonthlyFacts } from "../opiu/monthlyFacts.ts";
import { buildMonthlyOpiuStatement } from "../opiu/monthlyStatement.ts";
import { buildDdsSummary } from "../../components/payments/ddsSummary.ts";
import { ddsTemplateRows } from "../../components/payments/ddsExport.ts";

test("новая статья валидируется без дублей основных статей и без зарплатных/товарных целей", () => {
  assert.deepEqual(validateExpenseCategory({ name: "  Курсы   команды ", opiuArticleId: "training" }), { name: "Курсы команды", opiuArticleId: "training" });
  assert.deepEqual(validateExpenseCategory({ name: "Не для ОПиУ", opiuArticleId: "" }), { name: "Не для ОПиУ", opiuArticleId: null });
  for (const input of [{ name: "рко" }, { name: "" }, { name: "Курс", opiuArticleId: "cogs" }, { name: "Курс", opiuArticleId: "admin_salary" }]) assert.throws(() => validateExpenseCategory(input));
});

test("новая статья доступна в опциях и относится к операционной деятельности", () => {
  const names = ["Курсы команды"];
  assert.equal(categoryOptions(undefined, names).includes(names[0]), true);
  assert.equal(categoryOptions(names[0], names).filter((name) => name === names[0]).length, 1);
  assert.equal(categoryOptions("Старая статья", names)[0], "Старая статья");
  assert.equal(sectionForCategory(names[0], names), "Операционная");
  assert.equal(sectionForCategory(TRANSFER_CATEGORIES.outgoing, [TRANSFER_CATEGORIES.outgoing]), "Техническая");
});

test("подтверждённый расход новой статьи включается в существующую строку ОПиУ один раз", () => {
  const categories = [{ id: "c1", name: "Курсы команды", opiuArticleId: "training" }, { id: "c2", name: "Не для ОПиУ", opiuArticleId: null }];
  const shared = aggregateDdsMonthlyFacts([
    { amount: -100, category: "Курсы команды" },
    { amount: -20, category: "Курсы команды", comment: "[payroll:entry]" },
    { amount: 30, category: "Курсы команды" },
    { amount: -70, category: "Не для ОПиУ" },
  ], categories);
  assert.equal(shared.training.amount, 100);
  assert.equal(Object.keys(shared).length, 1);
  const statement = buildMonthlyOpiuStatement({ shared });
  assert.equal(statement.rows.find((row) => row.id === "training")?.amounts.shared.value, 100);
});

test("новая статья одинаково классифицируется в своде и выгрузке ДДС", () => {
  const payment = { id: "p1", date: "2026-09-14", amount: -100, category: "Курсы команды", status: "done" as const, accountId: "a1", name: "Курс", counterparty: "Школа" };
  const names = [payment.category];
  assert.equal(buildDdsSummary([payment], undefined, undefined, names).groups[0].section, "Операционная");
  const rows = ddsTemplateRows({ payments: [payment], accountNameById: new Map(), companyNameById: new Map(), customExpenseNames: names });
  assert.equal(rows[1][12], "Операционная");
});

test("все формы ДДС используют общий загружаемый справочник", () => {
  for (const path of ["payments/PaymentForm.tsx", "calendar/InlinePaymentForm.tsx", "calendar/BulkPaymentModal.tsx", "payments/BankStatementModal.tsx", "payments/BankReviewPanel.tsx"]) {
    const source = readFileSync(new URL(`../../components/${path}`, import.meta.url), "utf8");
    assert.match(source, /useDdsCategories\(\)/, path);
  }
});
