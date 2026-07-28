import { NextRequest, NextResponse } from "next/server";
import { buildMarketplacePayoutForecast } from "@/lib/opiu/forecast";
import { requireApiSession } from "@/lib/auth/apiGuard";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  const year = Number(request.nextUrl.searchParams.get("year"));
  const month = Number(request.nextUrl.searchParams.get("month"));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "Некорректный период" }, { status: 400 });
  }
  try {
    return NextResponse.json(await buildMarketplacePayoutForecast(year, month, {
      forceRecalculate: request.nextUrl.searchParams.get("force") === "1",
      payoutRules: {
        mode: request.nextUrl.searchParams.get("payoutMode") === "daily_request"
          ? "daily_request"
          : request.nextUrl.searchParams.get("payoutMode") === "wb_bank_auto"
            ? "wb_bank_auto"
            : "standard",
        withdrawalWaitDays: Number(request.nextUrl.searchParams.get("withdrawalWaitDays")) || 14,
        withdrawalIntervalDays: Number(request.nextUrl.searchParams.get("withdrawalIntervalDays")) || 14,
        bankTransferDays: Number(request.nextUrl.searchParams.get("bankTransferDays")) || 7,
        effectiveFrom: request.nextUrl.searchParams.get("effectiveFrom") || `${year}-${String(month).padStart(2, "0")}-01`,
      },
      orderToSaleLagDays: request.nextUrl.searchParams.has("orderToSaleLagDays")
        ? Number(request.nextUrl.searchParams.get("orderToSaleLagDays"))
        : undefined,
      cabinetId: request.nextUrl.searchParams.get("cabinet") || undefined,
    }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось рассчитать прогноз" },
      { status: 500 },
    );
  }
}
