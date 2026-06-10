import { NextRequest, NextResponse } from "next/server";
import { wbFetch } from "@/lib/wb/fetch";
import { stocksDateFrom } from "@/lib/wb/keys";
import type { WbStock } from "@/lib/wb/types";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("dateFrom") ?? stocksDateFrom();
  const refresh = searchParams.get("refresh") === "1";

  const url = new URL(
    "https://statistics-api.wildberries.ru/api/v1/supplier/stocks",
  );
  url.searchParams.set("dateFrom", dateFrom);

  const result = await wbFetch<WbStock[]>(
    url.toString(),
    { method: "GET" },
    { refresh },
  );

  return NextResponse.json(result);
}
