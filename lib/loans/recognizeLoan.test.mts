import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyLoanCorrections, recognizeLoanDocument } from "./recognizeLoan.ts";
import { recognizeLoanSpreadsheet } from "@/components/loans/loanRecognition";

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

test("Word-график по месяцам не теряет июль и август и применяет курс каждой даты", async () => {
  const requestedDates: string[] = [];
  const result = await recognizeLoanDocument({ description: `
    ДОГОВОР целевого процентного займа г. Москва 30.10.2019 г.
    Заимодавец Новиков Валерий Михайлович. Сумма займа 22 000 долларов США, 35 процентов годовых.
    Срок займа по договору: 30.10.2019 – 30.10.2020
    Период начисления процентов: 31.10.2019 – 30.10.2020
    2020 (366 дней) период дней сумма займа $ проценты $
    июль 31 22 000,00 653,97 по курсу ЦБ РФ на день платежа
    август 31 22 000,00 653,97 по курсу ЦБ РФ на день платежа
    сентябрь 30 22 000,00 632,88 по курсу ЦБ РФ на день платежа
    октябрь 30 22 000,00 632,88 по курсу ЦБ РФ на день платежа
  ` }, {
    ...deps,
    rate: async (_currency, date) => {
      if (date) requestedDates.push(date);
      const month = Number(date?.slice(5, 7) ?? 1);
      return { rate: 70 + month, date: date ?? "2026-10-06" };
    },
  });
  assert.deepEqual(result.schedule.map((row) => row.date), ["2020-07-31", "2020-08-31", "2020-09-30", "2020-10-30"]);
  assert.equal(result.schedule[0].interest, 653.97 * 77);
  assert.equal(result.schedule[1].interest, 653.97 * 78);
  assert.notEqual(result.schedule[0].interest, result.schedule[1].interest);
  assert.deepEqual(requestedDates.sort(), ["2020-07-31", "2020-08-31", "2020-09-30", "2020-10-30"]);
});

test("DOCX с разорванными датами и фиксированным валютным процентом даёт полный год", async () => {
  const result = await recognizeLoanDocument({ description: `
    ДОГОВОР ЗАЙМА № 1 г. Москва 25 .0 9 .2025 г.
    Гражданин РФ, Новиков Валерий Михайлович, именуемый Заимодавец.
    Заимодавец передает заем в размере 36 000 (тридцать шесть тысяч) долларов США.
    Заемщик возвращает сумму не позднее " 2 5 " сентября 202 6 г.
    Размер процентов составляет 35 процентов годовых.
    Размер процентов к ежемесячной уплате Заемщиком составляет 1050 долларов США.
  ` }, deps);
  assert.equal(result.recognized.startDate, "2025-09-25");
  assert.equal(result.recognized.dueDate, "2026-09-25");
  assert.equal(result.recognized.principalAmount, 36_000);
  assert.equal(result.recognized.currency, "USD");
  assert.equal(result.schedule.length, 12);
  assert.equal(result.schedule.find((row) => row.date === "2026-07-25")?.interestOriginal, 1050);
  assert.equal(result.schedule.find((row) => row.date === "2026-08-25")?.interestOriginal, 1050);
  assert.equal(result.schedule.at(-1)?.principalOriginal, 36_000);
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

test("помесячный Excel сохраняет начисления по месяцам, а не подменяет их оплатами", () => {
  const parsed = recognizeLoanSpreadsheet([
    ["Дата", "Статус", "Остаток тела на начало", "Начислено процентов", "Выплачено процентов", "Выплачено тела", "Остаток тела на конец", "Платёж за месяц"],
    ["28.02.2026", "Факт", "1000000", "69041.10", "40000", "0", "1000000", "40000"],
    ["31.03.2026", "Факт", "1000000", "60164.38", "0", "100000", "900000", "100000"],
    ["31.10.2026", "План", "800000", "48920.55", "312241.10", "0", "800000", "312241.10"],
    ["26.11.2026", "План", "800000", "29063.01", "30641.10", "800000", "0", "830641.10"],
  ]);
  assert.deepEqual(parsed.schedule, [
    { date: "2026-02-28", principal: 0, interest: 69041.1, penalty: 0, fine: 0, status: "planned", balanceBefore: 1000000, balanceAfter: 1000000 },
    { date: "2026-03-31", principal: 100000, interest: 60164.38, penalty: 0, fine: 0, status: "planned", balanceBefore: 1000000, balanceAfter: 900000 },
    { date: "2026-10-31", principal: 0, interest: 48920.55, penalty: 0, fine: 0, status: "planned", balanceBefore: 800000, balanceAfter: 800000 },
    { date: "2026-11-26", principal: 800000, interest: 29063.01, penalty: 0, fine: 0, status: "planned", balanceBefore: 800000, balanceAfter: 0 },
  ]);
  assert.equal(parsed.principalAmount, 1000000);
  assert.equal(parsed.dueDate, "2026-11-26");
});

test("детальный график из файла Хлестовой читает все будущие даты и суммы", () => {
  const parsed = recognizeLoanSpreadsheet([
    ["Месяц", "Дата платежа", "Назначение", "Тело до платежа", "Дней начисления", "Начислено процентов", "Проценты до платежа", "Платеж процентов", "Платеж тела", "Платеж всего", "Остаток процентов", "Остаток тела", "Долг после платежа"],
    ["Октябрь", "46296", "Проценты", "800000", "1", "1578.08", "264898.63", "30000", "0", "30000", "236476.71", "800000", "1036476.71"],
    ["Ноябрь", "46331", "Тело + текущие проценты", "800000", "6", "9468.49", "0", "9468.49", "100000", "109468.49", "0", "700000", "700000"],
    ["Ноябрь", "46352", "Тело + текущие проценты", "300000", "7", "4142.47", "0", "4142.47", "300000", "304142.47", "0", "0", "0"],
  ]);
  assert.deepEqual(parsed.schedule, [
    { date: "2026-10-01", principal: 0, interest: 30000, penalty: 0, fine: 0, status: "planned", balanceBefore: 800000, balanceAfter: 800000 },
    { date: "2026-11-05", principal: 100000, interest: 9468.49, penalty: 0, fine: 0, status: "planned", balanceBefore: 800000, balanceAfter: 700000 },
    { date: "2026-11-26", principal: 300000, interest: 4142.47, penalty: 0, fine: 0, status: "planned", balanceBefore: 300000, balanceAfter: 0 },
  ]);
  assert.equal(parsed.dueDate, "2026-11-26");
});

test("PDF без текстового слоя без ИИ требует OCR, а не даёт пустой результат", async () => {
  await assert.rejects(
    recognizeLoanDocument({ description: "", file: { name: "dogovor.pdf", bytes: Buffer.from("%PDF-1.4 %%EOF"), mimeType: "application/pdf" } }, deps),
    /текстовый слой/,
  );
});

test("текстовый PDF с графиком распознаётся без ИИ", async () => {
  const content = [
    "BT",
    "(Contract 2026022600069) Tj",
    "(Principal 2180000 RUB) Tj",
    "(1 10.03.2026 37299.26 9705.84 27593.42 0 2170294.16) Tj",
    "(2 17.03.2026 37299.26 9828.31 27470.95 0 2160465.85) Tj",
    "ET",
  ].join("\n");
  const pdf = `%PDF-1.4\n1 0 obj\n<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream\nendobj\n%%EOF`;
  const result = await recognizeLoanDocument({
    description: "",
    file: { name: "wb-finance.pdf", bytes: Buffer.from(pdf), mimeType: "application/pdf" },
  }, deps);
  assert.equal(result.recognized.principalAmount, 2180000);
  assert.equal(result.recognized.dueDate, "2026-03-17");
  assert.equal(result.recognized.interestFrequency, "weekly");
  assert.deepEqual(result.schedule.map((row) => [row.date, row.principal, row.interest, row.balanceAfter]), [
    ["2026-03-10", 9705.84, 27593.42, 2170294.16],
    ["2026-03-17", 9828.31, 27470.95, 2160465.85],
  ]);
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
