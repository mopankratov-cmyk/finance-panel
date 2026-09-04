import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyLoanCorrections, recognizeLoanDocument } from "./recognizeLoan.ts";

const deps = {
  rate: async (currency: string) => currency === "USD" ? { rate: 80, date: "2026-09-03" } : { rate: 1, date: "" },
  companies: [{ id: "c-1", name: "ООО Ромашка" }, { id: "c-2", name: "ИП Коровкин" }],
  accounts: [{ id: "a-1", name: "Точка 1234" }],
};

test("текстовое описание займа распознаётся на сервере без ИИ и даёт график", async () => {
  const result = await recognizeLoanDocument({ description: "Заем ООО Микрофинанс 500 000 рублей от 01.02.2026 до 01.02.2027 под 24% годовых. Проценты выплачиваются ежемесячно." }, deps);
  assert.equal(result.recognized.principalAmount, 500000);
  assert.equal(result.recognized.annualRate, 24);
  assert.equal(result.recognized.startDate, "2026-02-01");
  assert.equal(result.recognized.dueDate, "2027-02-01");
  assert.equal(result.recognized.interestFrequency, "monthly");
  assert.equal(result.schedule.length, 12);
  assert.equal(result.schedule.at(-1)?.principal, 500000);
  assert.equal(result.exchangeRate, 1);
});

test("XLSX-график банка читается по ячейкам сервером, ИИ его не подменяет", async () => {
  const bytes = readFileSync(new URL("../../tests/fixtures/loan-schedule-mini.xlsx", import.meta.url));
  const ai = async () => ({ schedule: [{ date: "2099-01-01", principal: 1, interest: 1 }], creditorName: "Кто-то другой", companyHint: "ромашка" });
  const result = await recognizeLoanDocument({ description: "", file: { name: "grafik.xlsx", bytes, mimeType: "" } }, { ...deps, ai });
  assert.deepEqual(result.schedule.map((row) => [row.date, row.principal, row.interest]), [
    ["2026-02-28", 0, 8219.18],
    ["2026-03-31", 500000, 7671.23],
  ]);
  assert.equal(result.recognized.dueDate, "2026-03-31");
  // Скалярные поля ИИ перекрывает (как и раньше в браузере); локальный приоритет — только у графика и даты возврата.
  assert.equal(result.recognized.creditorName, "Кто-то другой");
  assert.equal(result.suggestedCompanyId, "c-1", "компания подсказана по заёмщику из ИИ");
});

test("PDF без ИИ — честная ошибка, а не пустой результат", async () => {
  await assert.rejects(
    recognizeLoanDocument({ description: "", file: { name: "dogovor.pdf", bytes: Buffer.from("%PDF-1.4 %%EOF"), mimeType: "application/pdf" } }, deps),
    /ИИ-распознавание/,
  );
});

test("договор Дзюбина распознаётся локально при недоступном ИИ и сохраняет поквартальный рост тела", async () => {
  const result = await recognizeLoanDocument({
    description: "Договор займа ИМ-ДА-01 от 15.07.2023. Займодавец Дзюбин Александр Владимирович передает 5 000 000 рублей под 3% ежемесячно. Каждые три месяца дополнительная сумма займа равна сумме выплаченных процентов и увеличивает тело займа. Возврат 15.07.2026.",
  }, deps);
  assert.equal(result.recognized.principalAmount, 5_000_000, "сумма договора — первоначальное тело, не итог после реинвеста");
  assert.equal(result.terms?.reinvestEveryPeriods, 3);
  assert.equal(result.schedule[0].interest, 150_000);
  assert.equal(result.schedule[0].balanceAfter, 5_000_000);
  assert.equal(result.schedule[3].interest, 163_500);
  assert.equal(result.schedule[3].balanceBefore, 5_450_000);
  assert.equal(result.schedule.at(-1)?.principal, 14_063_323.91);
});

test("уточнение при первой загрузке продлевает договор Дзюбина и ИИ для него не вызывается", async () => {
  let aiCalled = false;
  const result = await recognizeLoanDocument({
    description: "продли договор до декабря 2026 года по той же логике, с увеличением тела. Договор займа Дзюбина: 5 000 000 рублей, 3% ежемесячно; ежеквартально дополнительная сумма займа равна сумме выплаченных процентов и увеличивает тело.",
  }, {
    ...deps,
    ai: async () => {
      aiCalled = true;
      throw new Error("Основной ИИ-сервис недоступен");
    },
  });
  assert.equal(aiCalled, false);
  assert.equal(result.recognized.dueDate, "2026-12-31");
  assert.equal(result.schedule.at(-1)?.date, "2026-12-31");
  assert.ok((result.schedule.at(-1)?.principal ?? 0) > 14_063_323.91);
  assert.match(result.actions.join(" "), /срок продлён/i);
});

test("комментарий к файлу передаётся ИИ отдельно и с приоритетом", async () => {
  let receivedInstructions = "";
  await recognizeLoanDocument({
    description: "продли до декабря 2026",
    file: { name: "dogovor.pdf", bytes: Buffer.from("%PDF-1.4 %%EOF"), mimeType: "application/pdf" },
  }, {
    ...deps,
    ai: async (body) => {
      receivedInstructions = body.instructions ?? "";
      return {
        creditorName: "Банк", principalAmount: 100_000, currency: "RUB", annualRate: 12,
        startDate: "2026-01-01", dueDate: "2026-12-31", interestFrequency: "at_maturity",
      };
    },
  });
  assert.equal(receivedInstructions, "продли до декабря 2026");
});

test("корректировка «перенести» применяется локальным парсером без ИИ", async () => {
  const base = await recognizeLoanDocument({ description: "Заем ООО Микрофинанс 100 000 рублей от 01.02.2026 до 01.05.2026 под 12% годовых. Проценты выплачиваются ежемесячно." }, deps);
  const result = await applyLoanCorrections({ existing: base.recognized, schedule: base.schedule, corrections: "перенести платёж с марта 2026 на июнь 2026", exchangeRate: 1 }, deps);
  assert.match(result.notice, /перенесён/);
  assert.ok(result.schedule.some((row) => row.date.startsWith("2026-06-")));
  assert.equal(result.schedule.length, base.schedule.length);
});
