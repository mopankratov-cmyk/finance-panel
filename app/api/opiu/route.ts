import { NextRequest, NextResponse } from "next/server";
import { loadOpiuMonth } from "@/lib/opiu/loadMonth";
import { parseMonthParam } from "@/lib/opiu/weeks";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const month = request.nextUrl.searchParams.get("month") ?? "";
  const refresh = request.nextUrl.searchParams.get("refresh") === "1";
  const { year, monthIndex } = parseMonthParam(month);

  try {
    const result = await loadOpiuMonth(year, monthIndex, refresh);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ошибка загрузки ОПиУ";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
