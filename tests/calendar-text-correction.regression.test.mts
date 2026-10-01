import test from "node:test";
import assert from "node:assert/strict";
import { parseTextSchedule, recognizeCalendarCorrection } from "../components/calendar/CalendarPage";
import type { Payment } from "../lib/types";

const target = [
  ["2026-10-01", 30000, "Погашение процентов"],
  ["2026-10-08", 30000, "Погашение процентов"],
  ["2026-10-15", 30000, "Погашение процентов"],
  ["2026-10-22", 30000, "Погашение процентов"],
  ["2026-10-29", 30000, "Погашение процентов"],
  ["2026-11-05", 375000, "Погашение тела займа"],
  ["2026-11-12", 375000, "Погашение тела займа"],
  ["2026-11-19", 375000, "Погашение тела займа"],
  ["2026-11-26", 375000, "Погашение тела займа"],
] as const;

const payment = (index: number): Payment => ({
  id: `pay-${index}`, date: index < 6 ? `2026-${index < 5 ? "10" : "11"}-${String(index < 5 ? 2 + index * 7 : 5).padStart(2, "0")}` : `2026-11-${String(12 + (index - 6) * 7).padStart(2, "0")}`,
  amount: index < 6 ? -30000 : -500000, name: "Алексею Хлестову", category: index < 6 ? "Оплата % по кредиту" : "Оплаты по кредитам и займам",
  accountId: "calendar", companyId: "rio", status: "planned", counterparty: "", comment: `[series:khlestov] weekly, платёж ${index + 1}`,
});

test("таблица без точек после номера распознаётся и оплаченная строка не создаёт новый план", () => {
  const text = ["№ Дата платежа Назначение платежа Сумма платежа", "1 21.09.2026 Оплаченные проценты 30 000 ₽", ...target.map(([date, amount, label], index) => `${index + 2} ${date.split("-").reverse().join(".")} ${label} ${amount.toLocaleString("ru-RU")} ₽`)].join("\n");
  const parsed = parseTextSchedule(text, 2026);
  assert.equal(parsed[0].label, "Оплаченные проценты");
  const result = recognizeCalendarCorrection(text, Array.from({ length: 9 }, (_, index) => payment(index)), 2026, "алексей");
  assert.equal(result.error, undefined);
  assert.deepEqual(result.correction?.updates.map((row) => [row.date, Math.abs(row.amount), row.category]), target.map(([date, amount, label]) => [date, amount, label.includes("тела") ? "Оплаты по кредитам и займам" : "Оплата % по кредиту"]));
  assert.match(result.correction?.summary ?? "", /оплаченные строки пропущены: 1/);
});
