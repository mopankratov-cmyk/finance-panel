export type DdsPeriodMode = "month" | "year" | "custom";

export function monthRange(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { from: "", to: "" };
  const [year, number] = month.split("-").map(Number);
  return { from: `${month}-01`, to: `${month}-${String(new Date(year, number, 0).getDate()).padStart(2, "0")}` };
}

export function yearRange(year: number) {
  return Number.isInteger(year) && year >= 2000 && year <= 2200
    ? { from: `${year}-01-01`, to: `${year}-12-31` }
    : { from: "", to: "" };
}

export function periodLabel(from: string, to: string, locale = "ru-RU") {
  if (!from || !to) return "Все даты";
  const render = (value: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
  return from === to ? render(from) : `${render(from)} — ${render(to)}`;
}

export function currentLocalMonth(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
