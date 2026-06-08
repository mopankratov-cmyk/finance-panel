import type { Currency } from "./types";

export function formatMoney(amount: number, currency: Currency = "RUB"): string {
  const formatted = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount));

  const sign = amount < 0 ? "−" : "";
  if (currency === "USD") {
    return `${sign}$${formatted}`;
  }
  return `${sign}${formatted} ₽`;
}

export function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatDateLong(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function formatDateShort(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
  }).format(date);
}

export function formatDayMonth(dateStr: string): string {
  const [, month, day] = dateStr.split("-").map(Number);
  return `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}`;
}

export function getDayNumber(dateStr: string): number {
  const [, , day] = dateStr.split("-").map(Number);
  return day;
}

export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function generateId(_prefix?: string): string {
  return crypto.randomUUID();
}
