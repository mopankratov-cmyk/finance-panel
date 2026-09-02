import assert from "node:assert/strict";
import test from "node:test";
import { classifyBankStatement } from "../../components/payments/bankAutoClassify.ts";
import { buildImportPlan } from "../../components/payments/ddsImport.ts";
import type { BankStatement } from "../../components/payments/bankStatement.ts";
import type { Account, Payment } from "../types.ts";

const companies = [
  { id: "c-1", name: "ИП Иванов", groupName: "РИО", isActive: true },
  { id: "c-2", name: "ИП Петров", groupName: "РИО", isActive: true },
];
const accounts: Account[] = [
  { id: "a-1", name: "Точка 1234", type: "bank", currency: "RUB", balance: 0 },
  { id: "a-2", name: "Т-Банк 1234", type: "bank", currency: "RUB", balance: 0 },
];
const statement = (overrides: Partial<BankStatement>): BankStatement => ({
  documentHash: "h", bank: "Банковская выписка", owner: "", ownerInn: "", accountNumber: "40702810000000001234",
  dateFrom: "2026-09-01", dateTo: "2026-09-01", openingBalance: 0, closingBalance: 0, declaredDebit: 0, declaredCredit: 0,
  rows: [{ id: "r1", date: "2026-09-01", amount: -1000, counterparty: "ООО Ромашка", counterpartyInn: "", counterpartyAccount: "", purpose: "оплата за услуги", documentNumber: "1" }],
  warnings: [], ...overrides,
});

test("не распознали владельца выписки — компания не назначается, строка идёт на проверку", () => {
  const [row] = classifyBankStatement(statement({ owner: "" }), accounts, companies, [], []);
  assert.equal(row.companyId, null);
  assert.equal(row.needsReview, true);
});

test("владелец подошёл под две компании — тоже ничья", () => {
  const twins = [{ id: "c-1", name: "ИП Иванов Иван", groupName: "РИО", isActive: true }, { id: "c-2", name: "ИП Иванов Пётр", groupName: "РИО", isActive: true }];
  const [row] = classifyBankStatement(statement({ owner: "Индивидуальный предприниматель Иванов" }), accounts, twins, [], []);
  assert.equal(row.companyId, null);
});

test("два кошелька с одинаковым хвостом номера счёта — кошелёк не угадывается", () => {
  const [row] = classifyBankStatement(statement({ owner: "ИП Иванов" }), accounts, companies, [], []);
  assert.equal(row.companyId, "c-1");
  assert.equal(row.accountId, null);
  const [single] = classifyBankStatement(statement({ owner: "ИП Иванов" }), [accounts[0]], companies, [], []);
  assert.equal(single.accountId, "a-1");
});

test("одна похожая операция в истории не назначает компанию и кошелёк", () => {
  const history: Array<Payment & { companyId?: string | null }> = [{
    id: "p-1", date: "2026-08-01", name: "оплата за услуги", amount: -1000, category: "ПО", accountId: "a-1", status: "done",
    counterparty: "ООО Ромашка", companyId: "c-2",
  }];
  const [row] = classifyBankStatement(statement({ owner: "" }), accounts, companies, history, []);
  assert.equal(row.companyId, null, "по одной операции компания не выводится");
  const [learned] = classifyBankStatement(statement({ owner: "" }), accounts, companies, [history[0], { ...history[0], id: "p-2", date: "2026-08-15" }], []);
  assert.equal(learned.companyId, "c-2", "по двум — уже история");
});

test("импорт из очереди берёт компанию по id, даже если имя не совпало", () => {
  const plan = buildImportPlan({
    drafts: [{ date: "2026-09-01", amount: -1000, name: "оплата", category: "ПО", wallet: "Точка 1234", counterparty: "", activity: "", company: "Старое имя", companyId: "c-2" }],
    wallets: ["Точка 1234"], walletDirectory: ["Точка 1234"], categories: ["ПО"], totalIncome: 0, totalExpense: 1000, skipped: 0, warnings: [],
  }, { accounts: [accounts[0]], payments: [] }, { companies });
  assert.equal(plan.newPaymentRows[0]?.company_id, "c-2");
  const byName = buildImportPlan({
    drafts: [{ date: "2026-09-01", amount: -1000, name: "оплата", category: "ПО", wallet: "Точка 1234", counterparty: "", activity: "", company: "ИП Петров" }],
    wallets: ["Точка 1234"], walletDirectory: ["Точка 1234"], categories: ["ПО"], totalIncome: 0, totalExpense: 1000, skipped: 0, warnings: [],
  }, { accounts: [accounts[0]], payments: [] }, { companies });
  assert.equal(byName.newPaymentRows[0]?.company_id, "c-2", "без id — по имени, как раньше");
});
