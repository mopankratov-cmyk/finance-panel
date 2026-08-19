import { NextRequest, NextResponse } from "next/server";
import { buildMarketplacePayoutForecast } from "@/lib/opiu/forecast";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { sessionHasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getActiveWbCabinets } from "@/lib/wb/cabinetTokens";
import { resolveForecastCabinet } from "@/lib/opiu/forecastCabinet";
import { OPIU_WB_CABINET_ID } from "@/lib/opiu/constants";
import { ForecastTimeoutError, runForecastWithin } from "@/lib/opiu/forecastRequest";

export const maxDuration = 60;
const FORECAST_BUDGET_MS = 50_000;

export async function GET(request: NextRequest) {
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  const year = Number(request.nextUrl.searchParams.get("year"));
  const month = Number(request.nextUrl.searchParams.get("month"));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "Некорректный период" }, { status: 400 });
  }

  // §3. Прогноз считается строго по одному WB-кабинету. Список кабинетов —
  // read-only источник истины wb_cabinets (только id/имя, без токенов), с учётом
  // доступа сессии. Смешивание кабинетов запрещено (§19).
  const session = await getServerSession();
  const cabinets = (await getActiveWbCabinets())
    .filter((cabinet) => sessionHasCabinetAccess(session, cabinet.id))
    .map((cabinet) => ({ id: cabinet.id, name: cabinet.name }));
  const requestedCabinet = request.nextUrl.searchParams.get("cabinet");
  if (!requestedCabinet) {
    return NextResponse.json({ cabinets });
  }
  const resolved = resolveForecastCabinet(
    cabinets,
    requestedCabinet,
    OPIU_WB_CABINET_ID,
  );
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error, cabinets }, { status: resolved.status });
  }

  try {
    const forecast = await runForecastWithin(
      (signal) => buildMarketplacePayoutForecast(year, month, {
        forceRecalculate: request.nextUrl.searchParams.get("force") === "1",
        signal,
        cabinetId: resolved.cabinetId,
      }),
      FORECAST_BUDGET_MS,
    );
    return NextResponse.json({ ...forecast, cabinetName: resolved.cabinetName, cabinets });
  } catch (error) {
    if (error instanceof ForecastTimeoutError) {
      return NextResponse.json({ error: error.message }, { status: 504 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось рассчитать прогноз" },
      { status: 500 },
    );
  }
}
