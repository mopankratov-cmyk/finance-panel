import { NextRequest, NextResponse } from "next/server";
import { cabinetIdFromParam } from "@/lib/rnp/resolveShop";
import { fetchCabinetPimRows } from "@/lib/wb/cards";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const p_cabinet = cabinetIdFromParam(new URL(req.url).searchParams.get("cabinet"));
  if (!(await hasCabinetAccess(p_cabinet))) {
    return NextResponse.json({ ok: false, error: "Нет доступа к кабинету" }, { status: 403 });
  }
  try {
    const rows = await fetchCabinetPimRows(p_cabinet);
    return NextResponse.json({ ok: true, rows, count: rows.length });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
