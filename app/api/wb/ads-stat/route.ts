import { NextRequest, NextResponse } from "next/server";
import { wbFetch } from "@/lib/wb/fetch";
import type { WbAdStat } from "@/lib/wb/types";

interface AdsStatBody {
  ids?: number[];
  beginDate?: string;
  endDate?: string;
}

export async function POST(request: NextRequest) {
  let body: AdsStatBody = {};

  try {
    const raw = await request.json();
    if (Array.isArray(raw)) {
      body = { ids: raw };
    } else {
      body = raw as AdsStatBody;
    }
  } catch {
    return NextResponse.json({
      data: null,
      error: "Тело запроса должно содержать ids, beginDate и endDate",
      timestamp: new Date().toISOString(),
    });
  }

  const ids = body.ids ?? [];
  const beginDate = body.beginDate;
  const endDate = body.endDate;

  if (ids.length === 0) {
    return NextResponse.json({
      data: [],
      error: null,
      timestamp: new Date().toISOString(),
    });
  }

  if (!beginDate || !endDate) {
    return NextResponse.json({
      data: null,
      error: "Параметры beginDate и endDate обязательны",
      timestamp: new Date().toISOString(),
    });
  }

  const url = new URL("https://advert-api.wildberries.ru/adv/v3/fullstats");
  url.searchParams.set("ids", ids.slice(0, 50).join(","));
  url.searchParams.set("beginDate", beginDate);
  url.searchParams.set("endDate", endDate);

  const cacheKey = ["ads-stat-v3", beginDate, endDate, ...ids.map(String).sort()];

  const result = await wbFetch<WbAdStat[]>(
    url.toString(),
    { method: "GET" },
    cacheKey,
  );

  return NextResponse.json(result);
}
