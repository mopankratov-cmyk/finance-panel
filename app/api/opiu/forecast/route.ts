import { NextRequest, NextResponse } from "next/server";
import { buildMarketplacePayoutForecast } from "@/lib/opiu/forecast";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const year = Number(request.nextUrl.searchParams.get("year"));
  const month = Number(request.nextUrl.searchParams.get("month"));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "Некорректный период" }, { status: 400 });
  }
  try {
    return NextResponse.json(await buildMarketplacePayoutForecast(year, month, {
      forceRecalculate: request.nextUrl.searchParams.get("force") === "1",
    }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось рассчитать прогноз" },
      { status: 500 },
    );
  }
}
