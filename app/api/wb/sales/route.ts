import { NextRequest, NextResponse } from "next/server";
import { wbFetch } from "@/lib/wb/fetch";
import type { WbReportRow } from "@/lib/wb/types";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const limit = searchParams.get("limit") ?? "100000";
  const rrdid = searchParams.get("rrdid") ?? "0";
  const refresh = searchParams.get("refresh") === "1";

  if (!dateFrom || !dateTo) {
    return NextResponse.json({
      data: null,
      error: "Параметры dateFrom и dateTo обязательны",
      timestamp: new Date().toISOString(),
    });
  }

  const url = new URL(
    "https://statistics-api.wildberries.ru/api/v5/supplier/reportDetailByPeriod",
  );
  url.searchParams.set("dateFrom", dateFrom);
  url.searchParams.set("dateTo", dateTo);
  url.searchParams.set("limit", limit);
  url.searchParams.set("rrdid", rrdid);

  const result = await wbFetch<WbReportRow[]>(
    url.toString(),
    { method: "GET" },
    { refresh },
  );

  return NextResponse.json(result);
}
