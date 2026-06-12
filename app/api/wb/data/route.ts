import { NextRequest, NextResponse } from "next/server";
import { loadWbData } from "@/lib/wb/loadData";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const refresh = request.nextUrl.searchParams.get("refresh") === "1";
  const data = await loadWbData(refresh);
  return NextResponse.json(data);
}
