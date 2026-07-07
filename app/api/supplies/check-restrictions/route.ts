import { NextRequest, NextResponse } from "next/server";
import { getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";
import { fetchAcceptanceCoefficients, WbSuppliesScopeError } from "@/lib/wb/supplies";

export const dynamic = "force-dynamic";

export interface RestrictionRow {
  warehouse: string;
  coefficient: number;
  status: "closed" | "paid" | "free";
  boxTypeName: string;
  date: string;
}

// GET ?cabinet=<uuid> — реальный вызов официального WB Supplies API (не WMS/МойСклад,
// см. lib/wb/supplies.ts). Ближайший коэффициент на склад (не вся 2-недельная сетка).
export async function GET(req: NextRequest) {
  const cabinetId = new URL(req.url).searchParams.get("cabinet");
  if (!cabinetId) return NextResponse.json({ ok: false, error: "Укажите ?cabinet=" }, { status: 400 });

  const cab = await getWbCabinet(cabinetId);
  if (!cab) return NextResponse.json({ ok: false, error: "Кабинет не найден" }, { status: 404 });
  const token = resolveWbToken(cab, "statistics");

  try {
    const coefs = await fetchAcceptanceCoefficients(token);
    const byWarehouse = new Map<string, RestrictionRow>();
    for (const c of coefs) {
      const cur = byWarehouse.get(c.warehouseName);
      if (!cur || new Date(c.date) < new Date(cur.date)) {
        byWarehouse.set(c.warehouseName, {
          warehouse: c.warehouseName,
          coefficient: c.coefficient,
          status: c.coefficient < 0 ? "closed" : c.coefficient === 0 ? "free" : "paid",
          boxTypeName: c.boxTypeName,
          date: c.date,
        });
      }
    }
    const rows = [...byWarehouse.values()].sort((a, b) => a.warehouse.localeCompare(b.warehouse, "ru"));
    return NextResponse.json({ ok: true, rows });
  } catch (err) {
    if (err instanceof WbSuppliesScopeError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 403 });
    }
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
