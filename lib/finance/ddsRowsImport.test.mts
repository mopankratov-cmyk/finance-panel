import assert from "node:assert/strict";
import test from "node:test";
import { parseDdsRows } from "../../components/payments/ddsCsv.ts";
import { buildImportPlan } from "../../components/payments/ddsImport.ts";
import type { Account, Payment } from "../types.ts";

test("XLSX-сетка ДДС сохраняет полное назначение и понимает серийную дату Excel", () => {
  const result = parseDdsRows([
    ["Кошельки", "ИП Панкратов Ozon"],
    ["Дата", "Сумма", "Кошелёк", "Направление бизнеса", "Контрагент", "Назначение платежа", "Статья", "Вид деятельности"],
    ["46270", "-15000", "ИП Панкратов Ozon", "ИП Панкратов", "Андрей Коровкин", "Выдача займа Андрею Коровкину по договору 17", "Выдача кредитов и займов", "Финансовая"],
  ]);

  assert.equal(result.drafts.length, 1);
  assert.equal(result.drafts[0].date, "2026-09-05");
  assert.equal(result.drafts[0].name, "Выдача займа Андрею Коровкину по договору 17");
  assert.match(result.drafts[0].comment ?? "", /Назначение платежа: Выдача займа Андрею Коровкину по договору 17/);
  assert.equal(result.drafts[0].counterparty, "Андрей Коровкин");
});

test("импорт ДДС принимает даты д.м.гггг и ISO", () => {
  const header = ["Дата", "Сумма", "Кошелек", "Назначение платежа", "Статья"];
  const result = parseDdsRows([
    header,
    ["1.2.2026", "100", "Касса", "Получен займ", "Получение кредитов и займов"],
    ["2026-08-31", "-100", "Касса", "Возврат займа", "Оплаты по кредитам и займам"],
  ]);
  assert.deepEqual(result.drafts.map((row) => row.date), ["2026-02-01", "2026-08-31"]);
});

test("одинаковые дата и сумма другого контрагента не считаются точным дублем", () => {
  const account: Account = { id: "account", name: "Расчётный счёт", type: "bank", currency: "RUB", balance: 0 };
  const existing: Payment = { id: "existing", date: "2026-08-31", amount: -10_000, name: "Возврат займа", category: "Оплаты по кредитам и займам", accountId: account.id, status: "done", counterparty: "Петров" };
  const parsed = parseDdsRows([
    ["Дата", "Сумма", "Кошелек", "Контрагент", "Назначение платежа", "Статья"],
    ["31.08.2026", "-10000", account.name, "Коровкин", "Возврат займа", existing.category],
  ]);
  const plan = buildImportPlan(parsed, { accounts: [account], payments: [existing] }, { companies: [], overrideCompanyId: null });
  assert.equal(plan.duplicatePayments, 0);
  assert.equal(plan.suspectedRows.length, 1, "совпадение требует проверки вместо тихого удаления");
});
