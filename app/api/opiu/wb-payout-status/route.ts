import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { sessionHasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";
import { normalizeWbFinanceReports, optionalMoney, scheduledWbPayouts } from "@/lib/opiu/wbPayoutStatus";

export const maxDuration = 30;

async function wbJson(url: string, token: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: token, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "detail" in payload ? String(payload.detail) : `WB ответил ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

export async function GET(request: NextRequest) {
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  const cabinetId = String(request.nextUrl.searchParams.get("cabinet") ?? "");
  const year = Number(request.nextUrl.searchParams.get("year"));
  const month = Number(request.nextUrl.searchParams.get("month"));
  if (!cabinetId || !Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "Выберите кабинет и корректный месяц" }, { status: 400 });
  }
  const session = await getServerSession();
  if (!sessionHasCabinetAccess(session, cabinetId)) return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  const cabinet = await getWbCabinet(cabinetId);
  if (!cabinet) return NextResponse.json({ error: "Кабинет WB не найден" }, { status: 404 });
  const token = resolveWbToken(cabinet, "statistics");
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  try {
    const [balancePayload, reportsPayload] = await Promise.all([
      wbJson("https://finance-api.wildberries.ru/api/v1/account/balance", token),
      wbJson("https://finance-api.wildberries.ru/api/finance/v1/sales-reports/list", token, {
        method: "POST",
        body: JSON.stringify({ dateFrom: from, dateTo: to, limit: 100, offset: 0, period: "weekly" }),
      }),
    ]);
    const balance = balancePayload && typeof balancePayload === "object" ? balancePayload as Record<string, unknown> : {};
    const reports = normalizeWbFinanceReports(reportsPayload);
    return NextResponse.json({
      cabinetId,
      cabinetName: cabinet.name,
      currency: String(balance.currency ?? "RUB"),
      currentBalance: optionalMoney(balance.current),
      availableForWithdrawal: optionalMoney(balance.for_withdraw),
      reports,
      scheduledPayouts: scheduledWbPayouts(reports),
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось получить финансовые данные WB" }, { status: 502 });
  }
}
