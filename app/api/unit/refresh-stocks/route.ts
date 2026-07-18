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

  const url = new URL("/api/sync/stocks", resolveSyncBase(requestUrl.origin));
  if (cabinetId) url.searchParams.set("cabinet", cabinetId);
  const secret = process.env.CRON_SECRET;
  const headers: Record<string, string> = secret ? { Authorization: `Bearer ${secret}` } : {};

  try {
    const response = await fetch(url, {
      headers,
      cache: "no-store",
    });
    const result = await response.json() as { ok?: boolean; rows?: number; error?: string; errors?: string[] };
    if (!response.ok || !result.ok) {
      return NextResponse.json({
        error: result.error || result.errors?.join("; ") || "Не удалось обновить остатки",
        sync: result,
      }, { status: 502 });
    }
    return NextResponse.json({ ok: true, rows: result.rows ?? 0 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Не удалось запустить синхронизацию остатков",
    }, { status: 502 });
  }
}
