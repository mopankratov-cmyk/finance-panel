import { NextResponse } from "next/server";
import { wbFetch } from "@/lib/wb/fetch";
import type { WbAdvertsResponse } from "@/lib/wb/types";

export async function GET() {
  const url = "https://advert-api.wildberries.ru/api/advert/v2/adverts";

  const result = await wbFetch<WbAdvertsResponse>(
    url,
    { method: "GET" },
    ["ads-v2"],
  );

  return NextResponse.json(result);
}
