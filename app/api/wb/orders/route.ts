import { NextRequest, NextResponse } from "next/server";
import { wbFetch } from "@/lib/wb/fetch";
import type { WbOrder } from "@/lib/wb/types";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("dateFrom");
  const flag = searchParams.get("flag") ?? "0";
  const refresh = searchParams.get("refresh") === "1";

  if (!dateFrom) {
    return NextResponse.json({
      data: null,
      error: "Параметр dateFrom обязателен",
      timestamp: new Date().toISOString(),
    });
  }

  const url = new URL(
    "https://statistics-api.wildberries.ru/api/v1/supplier/orders",
  );
  url.searchParams.set("dateFrom", dateFrom);
  url.searchParams.set("flag", flag);

  const result = await wbFetch<WbOrder[]>(
    url.toString(),
    { method: "GET" },
    { refresh },
  );

  return NextResponse.json(result);
}
