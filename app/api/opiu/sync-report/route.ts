import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { OPIU_WB_CABINET_ID } from "@/lib/opiu/constants";
import { syncReportRows } from "@/lib/opiu/syncReportRows";
import { getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";

export const maxDuration = 300;

function monthPeriod(month: string): { dateFrom: string; dateTo: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (year < 2024 || year > 2100 || monthNumber < 1 || monthNumber > 12) return null;
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    dateFrom: `${year}-${String(monthNumber).padStart(2, "0")}-01`,
    dateTo: `${year}-${String(monthNumber).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

export async function POST(request: Request) {
  const gate = await requireApiSession(["director"]);
  if (gate) return gate;

  try {
    const body = await request.json() as { month?: unknown };
    const month = typeof body.month === "string" ? body.month : "";
    const period = monthPeriod(month);
    if (!period) {
      return NextResponse.json(
        { error: "month must be in YYYY-MM format" },
        { status: 400 },
      );
    }

    const cabinet = await getWbCabinet(OPIU_WB_CABINET_ID);
    if (!cabinet) {
      return NextResponse.json(
        { error: "OPiU WB cabinet was not found" },
        { status: 404 },
      );
    }
    const token = resolveWbToken(cabinet, "statistics");
    const result = await syncReportRows(
      cabinet.id,
      token,
      period.dateFrom,
      period.dateTo,
    );

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Failed to sync WB financial report";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
