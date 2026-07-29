export type AttributedDrrStatus = "ready" | "no_attributed_orders" | "no_spend";

export interface ClosedMoscowPeriod {
  dateFrom: string;
  dateTo: string;
  dates: string[];
}

interface AdvertMetricRow {
  date: string;
  sum_spent: number | null;
  sum_orders: number | null;
}

const MOSCOW_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Moscow",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function getClosedMoscowPeriod(now = new Date(), days = 7): ClosedMoscowPeriod {
  const parts = Object.fromEntries(
    MOSCOW_DATE_FORMAT.formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const moscowToday = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  const dates = Array.from({ length: days }, (_, index) => {
    const date = new Date(moscowToday);
    date.setUTCDate(date.getUTCDate() - (days - index));
    return isoDate(date);
  });

  return { dateFrom: dates[0], dateTo: dates.at(-1)!, dates };
}

export function aggregateClosedAdvertMetrics(rows: AdvertMetricRow[], period: ClosedMoscowPeriod) {
  const includedDates = new Set(period.dates);
  let spent = 0;
  let attributedRevenue = 0;
  for (const row of rows) {
    if (!includedDates.has(String(row.date).slice(0, 10))) continue;
    spent += Number(row.sum_spent ?? 0);
    attributedRevenue += Number(row.sum_orders ?? 0);
  }

  const status: AttributedDrrStatus = spent <= 0
    ? "no_spend"
    : attributedRevenue <= 0
      ? "no_attributed_orders"
      : "ready";

  return {
    spent,
    attributedRevenue,
    attributedDrr: status === "ready" ? Math.round((spent / attributedRevenue) * 1_000) / 10 : null,
    status,
  };
}
