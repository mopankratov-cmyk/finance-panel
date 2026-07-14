import { NextRequest, NextResponse } from "next/server";
import { asSyncPayload, syncPayloadOk } from "@/lib/sync/result";

// Пользовательский триггер синков из UI: секрет подставляется на сервере,
// клиент его не видит. Допустимые задания фиксированы.
const ALLOWED = ["orders", "sales", "stocks", "adverts", "advert-stats", "funnel", "ozon-adverts", "commissions", "feedbacks", "moysklad", "history", "all"];

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
  // from/to — только для бэкфилла заказов/продаж.
  // cabinet также поддерживается остатками, чтобы тяжёлый кабинет синхронизировать отдельно.
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const cabinet = searchParams.get("cabinet");
  const params = new URLSearchParams();
  if (from && (job === "sales" || job === "orders")) params.set("from", from);
  if (to && (job === "sales" || job === "orders")) params.set("to", to);
  if (cabinet && (job === "sales" || job === "orders" || job === "stocks")) params.set("cabinet", cabinet);
  const qs = params.toString() ? `?${params.toString()}` : "";

  try {
    const res = await fetch(`${base}/api/sync/${job}${qs}`, { headers, cache: "no-store" });
    const body = asSyncPayload(await res.json().catch(() => ({})));
    const ok = syncPayloadOk(res.ok, body);
    return NextResponse.json(
      { ok, status: res.status, result: body },
      { status: ok ? 200 : res.ok ? 502 : res.status },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
