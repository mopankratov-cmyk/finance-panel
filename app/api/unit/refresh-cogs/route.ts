import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { hourlyDashboardTag } from "@/lib/cache/hourlyDashboard";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rawCabinet = new URL(request.url).searchParams.get("cabinet");
  const allCabinets = rawCabinet === null || rawCabinet === "all";
  const { cabinetId } = await resolveShopCabinet(allCabinets ? undefined : rawCabinet);
  if (!allCabinets && cabinetId === null) {
    return NextResponse.json({ error: "Кабинет не найден" }, { status: 404 });
  }
  if (!(await hasCabinetAccess(cabinetId))) return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });

  revalidateTag(hourlyDashboardTag("wb-unit-table", {
    cabinetId,
    taxPct: 7,
    ff: 0,
    targetMargin: 25,
  }), { expire: 0 });

  return NextResponse.json({
    ok: true,
    rows: 0,
    message: "Кэш юнит-экономики сброшен. Себестоимость перечитана из product_costs; автоматического источника в WB API нет.",
  });
}
