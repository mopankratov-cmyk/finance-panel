import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { sessionHasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";
import { normalizeWbFinanceReports, optionalMoney } from "@/lib/opiu/wbPayoutStatus";

export const maxDuration = 30;

interface CachedStatus {
  expiresAt: number;
  payload: Record<string, unknown>;
}

const statusCache = new Map<string, CachedStatus>();

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
  // Год ограничен так же, как в соседнем роуте снимков: без верхней и нижней
  // границы Date.UTC(year, …) кидает RangeError мимо try и отдаёт 500 вместо 400.
  if (!cabinetId || !Number.isInteger(year) || year < 2025 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "Выберите кабинет и корректный месяц" }, { status: 400 });
  }
  const session = await getServerSession();
  if (!sessionHasCabinetAccess(session, cabinetId)) return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  const cabinet = await getWbCabinet(cabinetId);
  if (!cabinet) return NextResponse.json({ error: "Кабинет WB не найден" }, { status: 404 });
  const token = resolveWbToken(cabinet, "statistics");
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const cacheKey = `${cabinetId}:${year}-${month}`;
  const cached = statusCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return NextResponse.json(cached.payload);
  try {
    const [balanceResult, reportsResult] = await Promise.allSettled([
      wbJson("https://finance-api.wildberries.ru/api/v1/account/balance", token),
      wbJson("https://finance-api.wildberries.ru/api/finance/v1/sales-reports/list", token, {
        method: "POST",
        body: JSON.stringify({ dateFrom: from, dateTo: to, limit: 100, offset: 0, period: "weekly" }),
      }),
    ]);
    const balancePayload = balanceResult.status === "fulfilled" ? balanceResult.value : null;
    const reportsPayload = reportsResult.status === "fulfilled" ? reportsResult.value : null;
    const balance = balancePayload && typeof balancePayload === "object" ? balancePayload as Record<string, unknown> : {};
    const reports = normalizeWbFinanceReports(reportsPayload);
    if (balanceResult.status === "rejected" && reportsResult.status === "rejected") {
      throw new Error("WB не вернул ни баланс, ни финансовые отчёты. Проверьте у токена категорию «Финансы» и повторите через минуту.");
    }
    const payload = {
      cabinetId,
      cabinetName: cabinet.name,
      currency: String(balance.currency ?? "RUB"),
      currentBalance: optionalMoney(balance.current),
      availableForWithdrawal: optionalMoney(balance.for_withdraw),
      reports,
      warnings: [
        ...(balanceResult.status === "rejected" ? ["Баланс WB временно недоступен"] : []),
        ...(reportsResult.status === "rejected" ? ["Финансовые отчёты WB временно недоступны"] : []),
      ],
      checkedAt: new Date().toISOString(),
    };
    statusCache.set(cacheKey, { expiresAt: Date.now() + 60_000, payload });
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось получить финансовые данные WB" }, { status: 502 });
  }
}
