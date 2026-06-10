import { NextRequest, NextResponse } from "next/server";
import { readWbCache } from "@/lib/wb/cacheRead";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  if (!dateFrom || !dateTo) {
    return NextResponse.json(
      { error: "Параметры dateFrom и dateTo обязательны" },
      { status: 400 },
    );
  }

  const data = await readWbCache(dateFrom, dateTo);
  return NextResponse.json(data);
}
