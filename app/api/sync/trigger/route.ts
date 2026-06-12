import { NextRequest, NextResponse } from "next/server";

// Пользовательский триггер синков из UI: секрет подставляется на сервере,
// клиент его не видит. Допустимые задания фиксированы.
const ALLOWED = ["orders", "sales", "stocks", "adverts", "advert-stats", "funnel", "all"];

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const job = searchParams.get("job") ?? "";
  if (!ALLOWED.includes(job)) {
    return NextResponse.json({ error: `Неизвестное задание: ${job}` }, { status: 400 });
  }

  const secret = process.env.CRON_SECRET;
  const base = new URL(request.url).origin;
  const headers: Record<string, string> = secret ? { Authorization: `Bearer ${secret}` } : {};

  try {
    const res = await fetch(`${base}/api/sync/${job}`, { headers, cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    return NextResponse.json({ ok: res.ok, status: res.status, result: body });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
