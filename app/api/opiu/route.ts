import { NextRequest, NextResponse } from "next/server";
import { loadOpiuMonth, loadOpiuSalePeriod } from "@/lib/opiu/loadMonth";
import { isValidDateParam, parseMonthParam } from "@/lib/opiu/weeks";
import { OPIU_BRANDS } from "@/lib/opiu/constants";

export const maxDuration = 60;

function resolveBrandId(request: NextRequest): string | undefined {
  const brand = request.nextUrl.searchParams.get("brand");
  return brand && OPIU_BRANDS.some((b) => b.id === brand) ? brand : undefined;
}

export async function GET(request: NextRequest) {
  const dateFrom = request.nextUrl.searchParams.get("dateFrom") ?? "";
  const dateTo = request.nextUrl.searchParams.get("dateTo") ?? "";
  const brandId = resolveBrandId(request);

  if (dateFrom || dateTo) {
    if (!isValidDateParam(dateFrom) || !isValidDateParam(dateTo) || dateFrom > dateTo) {
      return NextResponse.json({ error: "Некорректный диапазон дат" }, { status: 400 });
    }
    try {
      const result = await loadOpiuSalePeriod(dateFrom, dateTo, brandId);
      return NextResponse.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Ошибка загрузки ОПиУ";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const month = request.nextUrl.searchParams.get("month") ?? "";
  const refresh = request.nextUrl.searchParams.get("refresh") === "1";
  const { year, monthIndex } = parseMonthParam(month);

  try {
    const result = await loadOpiuMonth(year, monthIndex, refresh, brandId);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ошибка загрузки ОПиУ";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
