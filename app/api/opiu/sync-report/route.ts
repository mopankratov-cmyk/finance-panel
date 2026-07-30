import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import {
  OpiuReportCabinetNotFoundError,
  opiuReportMonthPeriod,
  syncOpiuReportMonth,
} from "@/lib/opiu/reportSync";

export const maxDuration = 300;

export async function POST(request: Request) {
  const gate = await requireApiSession(["director"]);
  if (gate) return gate;

  try {
    const body = await request.json() as { month?: unknown };
    const month = typeof body.month === "string" ? body.month : "";
    if (!opiuReportMonthPeriod(month)) {
      return NextResponse.json(
        { error: "month must be in YYYY-MM format" },
        { status: 400 },
      );
    }

    const result = await syncOpiuReportMonth(month);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof OpiuReportCabinetNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    const message = error instanceof Error
      ? error.message
      : "Failed to sync WB financial report";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
