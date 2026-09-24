export interface OpiuPaymentPeriodAllocation {
  id?: string;
  paymentId: string;
  periodMonth: string;
  amount: number;
}

export interface OpiuPaymentPeriodDraft {
  month: string;
  amount: number;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const money = (value: number) => Math.round(value * 100) / 100;

export function nextMonth(month: string, offset = 1): string {
  if (!MONTH.test(month)) throw new Error("Укажите месяц в формате ГГГГ-ММ");
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Делит сумму в копейках: остаток получает первая строка, поэтому итог точный. */
export function spreadOpiuPaymentEvenly(total: number, startMonth: string, months: number): OpiuPaymentPeriodDraft[] {
  if (!MONTH.test(startMonth)) throw new Error("Укажите первый месяц");
  if (!Number.isInteger(months) || months < 1 || months > 120) throw new Error("Количество месяцев — от 1 до 120");
  const totalCents = Math.round(Math.abs(total) * 100);
  if (totalCents < months) throw new Error("Сумма слишком мала для выбранного количества месяцев");
  const base = Math.floor(totalCents / months);
  const remainder = totalCents - base * months;
  return Array.from({ length: months }, (_, index) => ({
    month: nextMonth(startMonth, index),
    amount: (base + (index < remainder ? 1 : 0)) / 100,
  }));
}

export function validateOpiuPaymentPeriodDrafts(total: number, rows: readonly OpiuPaymentPeriodDraft[]) {
  if (!rows.length) return [];
  if (rows.length > 120) throw new Error("Можно распределить платёж максимум на 120 месяцев");
  const seen = new Set<string>();
  const normalized = rows.map((row) => {
    const month = String(row.month ?? "").trim();
    const amount = money(Number(row.amount));
    if (!MONTH.test(month)) throw new Error("У каждой строки должен быть выбран месяц");
    if (seen.has(month)) throw new Error(`Месяц ${month} указан дважды`);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Сумма за ${month} должна быть больше нуля`);
    seen.add(month);
    return { month, amount };
  });
  const allocated = money(normalized.reduce((sum, row) => sum + row.amount, 0));
  const expected = money(Math.abs(total));
  if (allocated !== expected) {
    throw new Error(`Распределено ${allocated.toLocaleString("ru-RU")} ₽ из ${expected.toLocaleString("ru-RU")} ₽`);
  }
  return normalized.sort((left, right) => left.month.localeCompare(right.month));
}

