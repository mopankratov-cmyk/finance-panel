import assert from "node:assert/strict";
import test from "node:test";
import { applyLoanScheduleCorrections, type EditableLoanScheduleRow } from "./loanScheduleCorrections.ts";

const row = (date: string, principal: number, interest: number, status: EditableLoanScheduleRow["status"] = "planned"): EditableLoanScheduleRow => ({ id: date, date, principal, interest, penalty: 0, fine: 0, status });
const makeRow = (value: Omit<EditableLoanScheduleRow, "id">): EditableLoanScheduleRow => ({ id: `new-${value.date}`, ...value });

test("marks the unpaid range and moves the December 2024 installment to March 2025", () => {
  const result = applyLoanScheduleCorrections([
    row("2024-12-01", 202_211.67, 179_692.86, "done"),
    row("2025-01-01", 205_918.88, 175_985.65, "done"),
    row("2025-02-01", 209_694.06, 172_210.47, "done"),
    row("2025-03-01", 213_538.46, 168_366.08),
  ], "С декабря 2024 по февральь 2025 не платили, нужно перенести платеж с декабря на март", makeRow);

  assert.equal(result.actions.length, 2);
  assert.equal(result.schedule.some((item) => item.date === "2024-12-01"), false);
  assert.equal(result.schedule.filter((item) => item.date === "2025-03-01").length, 2);
  assert.equal(result.schedule.find((item) => item.id === "2025-01-01")?.status, "planned");
});

test("replaces a schedule from pasted labeled rows", () => {
  const result = applyLoanScheduleCorrections(
    [row("2025-01-01", 100, 10)],
    "Заменить график\n01.04.2025 тело 300000; проценты 12000\n01.05.2025 тело 310000; проценты 9000; пени 500",
    makeRow,
  );
  assert.deepEqual(result.schedule.map(({ date, principal, interest, penalty }) => ({ date, principal, interest, penalty })), [
    { date: "2025-04-01", principal: 300_000, interest: 12_000, penalty: 0 },
    { date: "2025-05-01", principal: 310_000, interest: 9_000, penalty: 500 },
  ]);
});
