import assert from "node:assert/strict";
import test from "node:test";
import { isCalendarCashFlow } from "../../components/calendar/calendarPlan.ts";
import { analyzeFinances, FORECAST_HORIZON_DAYS } from "../opiu/financialIntelligence.ts";
import { recalculatePlannedLoanPayment } from "../opiu/loanCurrency.ts";
import type { Payment } from "../types.ts";

const pay = (over: Partial<Payment>): Payment => ({ id: "p", date: "2026-09-10", name: "", amount: 100, category: "Прочее", accountId: "a", status: "planned", counterparty: "", ...over });

test("в календаре видны все поступления, кроме переводов между своими счетами", () => {
  assert.equal(isCalendarCashFlow(pay({ category: "Кешбэк", amount: 5_000 })), true);
  assert.equal(isCalendarCashFlow(pay({ category: "Прочее", amount: 5_000 })), true);
  assert.equal(isCalendarCashFlow(pay({ category: "Поступление — Перевод между счетами", amount: 5_000 })), false);
  assert.equal(isCalendarCashFlow(pay({ amount: -5_000 })), true);
  assert.equal(isCalendarCashFlow(pay({ amount: 5_000, status: "cancelled" })), false);
});

test("финансовый контроль смотрит на 90 дней и не берёт технические переводы", () => {
  assert.equal(FORECAST_HORIZON_DAYS, 90);
  const result = analyzeFinances({
    accounts: [{ id: "a", name: "Счёт", type: "bank", currency: "RUB", balance: 100_000 }],
    payments: [
      pay({ id: "far", date: "2027-06-01", amount: -1_000_000 }),
      pay({ id: "transfer", date: "2026-09-10", amount: -900_000, category: "Выбытие — Перевод между счетами" }),
      pay({ id: "near", date: "2026-09-20", amount: -30_000 }),
    ],
    today: "2026-09-04",
  });
  assert.equal(result.forecast.lowestBalance, 70_000, "далёкий и технический не влияют");
});

test("валютный пересчёт не трогает просроченные строки графика", () => {
  const row = pay({ id: "r", date: "2026-08-01", amount: -8_000, comment: "[loan:1:schedule:x:interest] [currency:USD] [fx-rate:80] [amount-original:100]" });
  assert.equal(recalculatePlannedLoanPayment(row, 90, "2026-09-04", "2026-09-04"), null, "просрочка не пересчитывается");
  const future = { ...row, date: "2026-10-01" };
  assert.equal(recalculatePlannedLoanPayment(future, 90, "2026-09-04", "2026-09-04")?.amount, -9_000);
});
