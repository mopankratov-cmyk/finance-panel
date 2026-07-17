import { NextRequest, NextResponse } from "next/server";
import { asSyncPayload, syncPayloadOk } from "@/lib/sync/result";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { resolveSyncBase } from "@/lib/sync/orchestrator";

// Пользовательский триггер синков из UI: секрет подставляется на сервере,
// клиент его не видит. Допустимые задания фиксированы.
const ALLOWED = ["orders", "sales", "stocks", "adverts", "advert-stats", "funnel", "ozon-adverts", "commissions", "feedbacks", "token-health", "moysklad", "history", "all"];

// Ручной запуск комиссий ждёт дочерний Finance API sync, где между страницами
// обязателен минутный интервал WB. Остальные задания от увеличения лимита не
// становятся дольше — они по-прежнему завершаются по собственным ограничениям.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const gate = await requireApiSession(["director", "manager"]);
  if (gate) return gate;
  const { searchParams } = new URL(request.url);
  const job = searchParams.get("job") ?? "";
  if (!ALLOWED.includes(job)) {
    return NextResponse.json({ error: `Неизвестное задание: ${job}` }, { status: 400 });
  }

  const secret = process.env.CRON_SECRET;
  const base = resolveSyncBase(new URL(request.url).origin);
  const headers: Record<string, string> = secret ? { Authorization: `Bearer ${secret}` } : {};
  // from/to — только для бэкфилла заказов/продаж.
  // cabinet также поддерживается остатками, чтобы тяжёлый кабинет синхронизировать отдельно.
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const cabinet = searchParams.get("cabinet");
  if (cabinet && !(await hasCabinetAccess(cabinet))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const params = new URLSearchParams();
  if (from && (job === "sales" || job === "orders")) params.set("from", from);
  if (to && (job === "sales" || job === "orders")) params.set("to", to);
  if (cabinet && ["sales", "orders", "stocks", "adverts", "advert-stats", "funnel", "feedbacks", "commissions"].includes(job)) params.set("cabinet", cabinet);
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
