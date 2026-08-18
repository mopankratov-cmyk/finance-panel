import type { ForecastPublishRow, ForecastPublishScope } from "@/lib/opiu/calendarForecastPublish";

export async function publishForecastToCalendar(scope: ForecastPublishScope, rows: ForecastPublishRow[]) {
  const response = await fetch("/api/opiu/calendar-publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope, rows, approved: true }),
  });
  const result = await response.json().catch(() => null) as { error?: string; published?: number; cancelled?: number } | null;
  if (!response.ok) throw new Error(result?.error || "Не удалось перенести прогноз в календарь");
  return { published: Number(result?.published ?? 0), cancelled: Number(result?.cancelled ?? 0) };
}
