import { NextResponse } from "next/server";
import { getActiveWbCabinets } from "@/lib/wb/cabinetTokens";

export const dynamic = "force-dynamic";

// Список «магазинов» для РНП (контракт inferno: [{key, label}]).
// key = "all" (все кабинеты) или uuid активного WB-кабинета.
export async function GET() {
  const cabs = await getActiveWbCabinets();
  const shops = [
    { key: "all", label: "Все кабинеты" },
    ...cabs.map((c) => ({ key: c.id, label: c.name })),
  ];
  return NextResponse.json(shops);
}
