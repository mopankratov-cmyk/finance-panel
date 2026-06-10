import { NextRequest, NextResponse } from "next/server";
import { wbFetch } from "@/lib/wb/fetch";
import type { WbAdvertsResponse } from "@/lib/wb/types";

export async function GET(request: NextRequest) {
  const refresh =
    new URL(request.url).searchParams.get("refresh") === "1";
  const url = "https://advert-api.wildberries.ru/api/advert/v2/adverts";

  const result = await wbFetch<WbAdvertsResponse>(
    url,
    { method: "GET" },
    { refresh },
  );

  return NextResponse.json(result);
}
