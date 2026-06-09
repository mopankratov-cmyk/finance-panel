import { NextRequest, NextResponse } from "next/server";
import { wbFetch } from "@/lib/wb/fetch";
import type { WbAdStat } from "@/lib/wb/types";

export async function POST(request: NextRequest) {
  let ids: number[] = [];

  try {
    const body = await request.json();
    ids = Array.isArray(body) ? body : body.ids ?? [];
  } catch {
    return NextResponse.json({
      data: null,
      error: "Тело запроса должно содержать массив ID кампаний",
      timestamp: new Date().toISOString(),
    });
  }

  if (ids.length === 0) {
    return NextResponse.json({
      data: [],
      error: null,
      timestamp: new Date().toISOString(),
    });
  }

  const url = "https://advert-api.wildberries.ru/adv/v2/fullstat";
  const cacheKey = ["ads-stat", ...ids.map(String).sort()];

  const result = await wbFetch<WbAdStat[]>(
    url,
    {
      method: "POST",
      body: JSON.stringify(ids),
    },
    cacheKey,
  );

  return NextResponse.json(result);
}
