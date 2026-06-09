import { NextRequest, NextResponse } from "next/server";
import { wbFetch } from "@/lib/wb/fetch";
import type { WbStock } from "@/lib/wb/types";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  let dateFrom = searchParams.get("dateFrom");

  if (!dateFrom) {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    dateFrom = d.toISOString();
  }

  const url = new URL(
    "https://statistics-api.wildberries.ru/api/v1/supplier/stocks",
  );
  url.searchParams.set("dateFrom", dateFrom);

  const result = await wbFetch<WbStock[]>(
    url.toString(),
    { method: "GET" },
    ["stocks", dateFrom],
  );

  return NextResponse.json(result);
}
