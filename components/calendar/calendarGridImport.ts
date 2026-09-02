import { parseCsv, parseRussianAmount } from "@/components/payments/ddsCsv";
import { generateId } from "@/lib/format";
import type { Payment } from "@/lib/types";
import { setPaymentPriorityComment, suggestPaymentPriority } from "./paymentPriority";

const DAY_COLUMNS = [
  { amount: 0, name: 1, status: 2 },
  { amount: 3, name: 4, status: 5 },
  { amount: 6, name: 7, status: 8 },
  { amount: 9, name: 10, status: 11 },
  { amount: 12, name: 13, status: 14 },
  { amount: 15, name: 16, status: -1 },
  { amount: 17, name: 18, status: -1 },
];

function categoryForName(name: string) {
  const text = name.toLowerCase().replace(/ё/g, "е");
  if (/(зарплат|зп |аванс зп)/.test(text)) return "Зарплата";
  if (/(налог|усн|ндс|страхов)/.test(text)) return "Налоги";
  if (/(кредит|джет|лендер|процент|сбербанк)/.test(text)) return "Кредиты и займы";
  if (/(займ|микрозайм)/.test(text)) return "Займы";
  if (/(реклам|выкуп|сравнение карточ)/.test(text)) return "Реклама";
  if (/(дивиденд)/.test(text)) return "Дивиденды";
  if (/(логист|образц)/.test(text)) return "Логистика";
  // «по» подстрокой ловило «покупка», «поставщик», «погашение» — программы распознаём по явным словам.
  if (/(тильда|программ|лицензи|подписк|поддержк|честный знак|торговый знак)/.test(text)) return "Сервисы";
  return "Прочее";
}

function isoDate(year: number, targetMonth: number, day: number, weekIndex: number, weekCount: number) {
  let month = targetMonth;
  if (weekIndex === 0 && day > 20) month--;
  if (weekIndex === weekCount - 1 && day < 7) month++;
  const date = new Date(year, month, day);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseCalendarGrid(matrix: string[][], accountId: string, fallbackPeriod?: { year: number; month: number }): Payment[] {
  const normalizedRows = matrix.slice(0, 20).map((row) => row.map((cell) => String(cell ?? "").toLowerCase().replace(/ё/g, "е").trim()));
  const isLoanSchedule = normalizedRows.some((row) => row.includes("тип плановой операции") && row.includes("дата платежа") && row.includes("плановая сумма"));
  if (isLoanSchedule) {
    throw new Error("Это график кредита. Загрузите его в разделе «Кредиты и займы» — тело, проценты и неустойки будут разнесены отдельно и затем попадут в календарь");
  }
  const headingCandidates = matrix.slice(0, 30).flatMap((row) => row.slice(0, 20)).map((cell) => cell?.trim()).filter(Boolean);
  const title = headingCandidates.find((cell) => /\b20\d{2}\b/.test(cell) && /(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)/i.test(cell))
    ?? headingCandidates.find((cell) => /\b20\d{2}\b/.test(cell))
    ?? "";
  const year = Number(title.match(/\b(20\d{2})\b/)?.[1]) || fallbackPeriod?.year || 0;
  if (!year) throw new Error("Не удалось определить год календаря. Укажите год и месяц в заголовке файла, например «Сентябрь 2026»");
  const monthNames = ["январ", "феврал", "март", "апрел", "ма", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];
  const titleMonth = monthNames.findIndex((name) => title.toLowerCase().includes(name));
  const targetMonth = titleMonth >= 0 ? titleMonth : (fallbackPeriod ? fallbackPeriod.month - 1 : -1);
  if (targetMonth < 0) throw new Error("Не удалось определить месяц календаря. Укажите в заголовке название месяца и год");
  const weekRows = matrix.map((row, index) => row[0]?.toLowerCase().startsWith("неделя") ? index : -1).filter((index) => index >= 0);
  const payments: Payment[] = [];

  weekRows.forEach((weekRow, weekIndex) => {
    const dateRow = matrix[weekRow + 1] ?? [];
    const incomeRow = matrix[weekRow + 2] ?? [];
    const endRow = weekRows[weekIndex + 1] ?? matrix.length;
    const dates = DAY_COLUMNS.map((columns) => {
      const day = Number(dateRow[columns.amount]);
      return day ? isoDate(year, targetMonth, day, weekIndex, weekRows.length) : "";
    });

    DAY_COLUMNS.forEach((columns, dayIndex) => {
      const date = dates[dayIndex];
      const income = parseRussianAmount(incomeRow[columns.name] ?? "");
      if (date && income && income > 0) {
        payments.push({
          id: generateId("calendar-import"),
          date,
          amount: income,
          name: "Плановое поступление — источник и компания требуют уточнения",
          category: "Продажи на МП (требует уточнения)",
          accountId,
          status: "planned",
          counterparty: "",
          comment: setPaymentPriorityComment("Импортировано из платёжного календаря РИО", "B"),
        });
      }
    });

    for (let rowIndex = weekRow + 4; rowIndex < endRow; rowIndex++) {
      const row = matrix[rowIndex] ?? [];
      for (let dayIndex = 0; dayIndex < DAY_COLUMNS.length; dayIndex++) {
        const columns = DAY_COLUMNS[dayIndex];
        const amount = parseRussianAmount(row[columns.amount] ?? "");
        const name = row[columns.name]?.trim() ?? "";
        if (!dates[dayIndex] || !amount || amount <= 0 || !name || /остаток|сальдо|поступлен|выбыт/i.test(name)) continue;
        const category = categoryForName(name);
        const explicitStatus = columns.status >= 0 ? row[columns.status]?.trim().toLowerCase() : "";
        payments.push({
          id: generateId("calendar-import"),
          date: dates[dayIndex],
          amount: -Math.abs(amount),
          name,
          category,
          accountId,
          status: explicitStatus === "оплачено" ? "done" : "planned",
          counterparty: "",
          comment: setPaymentPriorityComment("Импортировано из платёжного календаря РИО", suggestPaymentPriority(category, name)),
        });
      }
    }
  });
  if (!payments.length) throw new Error("В календаре не найдено платежей");
  return payments;
}

export function parseCalendarGridCsv(text: string, accountId: string, fallbackPeriod?: { year: number; month: number }): Payment[] {
  return parseCalendarGrid(parseCsv(text), accountId, fallbackPeriod);
}
