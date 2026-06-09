import { NextResponse } from "next/server";
import { wbFetch } from "@/lib/wb/fetch";
import type { WbAdCount } from "@/lib/wb/types";

export async function GET() {
  const url = "https://advert-api.wildberries.ru/adv/v1/promotion/count";

  const result = await wbFetch<WbAdCount>(
    url,
    { method: "GET" },
    ["ads-count"],
  );

  return NextResponse.json(result);
}
