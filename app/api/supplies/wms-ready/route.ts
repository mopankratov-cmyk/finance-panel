import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// WMS-готовность (кука МойСклад + список складов). Интеграция WMS отложена — см. docs/отложено.md.
export async function GET() {
  return NextResponse.json({ cookie: false, warehouses: [] });
}
