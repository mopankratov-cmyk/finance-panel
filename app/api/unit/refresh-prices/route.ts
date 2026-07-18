import { NextRequest, NextResponse } from "next/server";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { resolveSyncBase } from "@/lib/sync/orchestrator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const rawCabinet = requestUrl.searchParams.get("cabinet");
  const allCabinets = rawCabinet === null || rawCabinet === "all";
  const { cabinetId } = await resolveShopCabinet(allCabinets ? undefined : rawCabinet);
  if (!allCabinets && cabinetId === null) {
    return NextResponse.json({ error: "Кабинет не найден" }, { status: 404 });
  }
  if (!(await hasCabinetAccess(cabinetId))) return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });

  const secret = process.env.CRON_SECRET;
  const headers: Record<string, string> = secret ? { Authorization: `Bearer ${secret}` } : {};
  const syncBase = resolveSyncBase(requestUrl.origin);
  const syncUrl = (job: "orders" | "sales") => {
    const url = new URL(`/api/sync/${job}`, syncBase);
    if (cabinetId) url.searchParams.set("cabinet", cabinetId);
    return url;
  };

  try {
    const [ordersResponse, salesResponse] = await Promise.all([
      fetch(syncUrl("orders"), { headers, cache: "no-store" }),
      fetch(syncUrl("sales"), { headers, cache: "no-store" }),
    ]);
    const [orders, sales] = await Promise.all([
      ordersResponse.json() as Promise<{ ok?: boolean; rows?: number; error?: string; errors?: string[] }>,
      salesResponse.json() as Promise<{ ok?: boolean; rows?: number; error?: string; errors?: string[] }>,
    ]);

    if (!ordersResponse.ok || !salesResponse.ok || !orders.ok || !sales.ok) {
      return NextResponse.json({
        error: "Не удалось обновить цены",
        orders,
        sales,
      }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      rows: (orders.rows ?? 0) + (sales.rows ?? 0),
      ordersRows: orders.rows ?? 0,
      salesRows: sales.rows ?? 0,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Не удалось запустить синхронизацию цен",
    }, { status: 502 });
  }
}
