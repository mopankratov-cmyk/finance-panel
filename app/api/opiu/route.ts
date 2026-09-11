import { NextRequest, NextResponse } from "next/server";
import { loadOpiuRollingWeeks, loadOpiuSalePeriod } from "@/lib/opiu/loadMonth";
import { isValidDateParam, todayParam } from "@/lib/opiu/weeks";
import { OPIU_BRANDS } from "@/lib/opiu/constants";

export const maxDuration = 60;

/** Ширина скользящего окна на вкладке "Свод по дате продажи" — см. PR с обсуждением. */
const ROLLING_WEEKS_COUNT = 4;

function resolveBrandIds(request: NextRequest): string[] {
  return request.nextUrl.searchParams
    .getAll("brand")
    .filter((brand) => OPIU_BRANDS.some((b) => b.id === brand));
}

export async function GET(request: NextRequest) {
  const dateFrom = request.nextUrl.searchParams.get("dateFrom") ?? "";
  const dateTo = request.nextUrl.searchParams.get("dateTo") ?? "";
  const brandIds = resolveBrandIds(request);

  if (dateFrom || dateTo) {
    if (!isValidDateParam(dateFrom) || !isValidDateParam(dateTo) || dateFrom > dateTo) {
      return NextResponse.json({ error: "Некорректный диапазон дат" }, { status: 400 });
    }
    try {
      const result = await loadOpiuSalePeriod(dateFrom, dateTo, brandIds);
      return NextResponse.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Ошибка загрузки ОПиУ";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const endDateParam = request.nextUrl.searchParams.get("endDate") ?? "";
  const refresh = request.nextUrl.searchParams.get("refresh") === "1";
  if (endDateParam && !isValidDateParam(endDateParam)) {
    return NextResponse.json({ error: "Некорректная дата" }, { status: 400 });
  }
  const endDate = endDateParam || todayParam();

  try {
    const result = await loadOpiuRollingWeeks(endDate, ROLLING_WEEKS_COUNT, refresh, brandIds);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ошибка загрузки ОПиУ";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
