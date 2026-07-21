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
  if (/(тильда|по|поддержк|честный знак|торговый знак)/.test(text)) return "Сервисы";
  return "Прочее";
}

function isoDate(year: number, targetMonth: number, day: number, weekIndex: number, weekCount: number) {
  let month = targetMonth;
  if (weekIndex === 0 && day > 20) month--;
  if (weekIndex === weekCount - 1 && day < 7) month++;
  const date = new Date(year, month, day);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseCalendarGridCsv(text: string, accountId: string): Payment[] {
  const matrix = parseCsv(text);
  const title = matrix[0]?.[0] ?? "";
  const year = Number(title.match(/\b(20\d{2})\b/)?.[1]);
  if (!year) throw new Error("Не удалось определить год календаря");
  const monthNames = ["январ", "феврал", "март", "апрел", "ма", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];
  const targetMonth = monthNames.findIndex((name) => title.toLowerCase().includes(name));
  if (targetMonth < 0) throw new Error("Не удалось определить месяц календаря");
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
