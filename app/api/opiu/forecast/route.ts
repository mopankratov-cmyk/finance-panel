import { NextRequest, NextResponse } from "next/server";
import { buildMarketplacePayoutForecast } from "@/lib/opiu/forecast";
import { requireApiSession } from "@/lib/auth/apiGuard";
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
  try {
    return NextResponse.json(await runForecastWithin(
      (signal) => buildMarketplacePayoutForecast(year, month, {
        forceRecalculate: request.nextUrl.searchParams.get("force") === "1",
        signal,
      }),
      FORECAST_BUDGET_MS,
    ));
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
