import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Список магазинов (контракт inferno: [{key, label}]). У нас единый кабинет.
export async function GET() {
  return NextResponse.json([{ key: "all", label: "Магазин" }]);
}
