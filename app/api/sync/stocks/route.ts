import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets } from "@/lib/sync/cabinets";
import { allowsProduct, isScoped } from "@/lib/wb/productScope";
import { WbStocksApiError, wbWarehouseStockPages } from "@/lib/wb/stocksApi";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const allTargets = await getWbSyncTargets();
  if (!allTargets.length) {
    return NextResponse.json({ error: "Нет активных кабинетов и WB_STATS_TOKEN не настроен" }, { status: 500 });
  }
  const onlyCabinet = request.nextUrl.searchParams.get("cabinet");
  const targets = onlyCabinet ? allTargets.filter((target) => target.cabinetId === onlyCabinet) : allTargets;
  if (!targets.length) {
    return NextResponse.json({ error: `Кабинет не найден: ${onlyCabinet}` }, { status: 404 });
  }

  let total = 0;
  const errors: string[] = [];

  try {
    for (const t of targets) {
      // Новый метод WB не возвращает бренд. Для кабинета с пустым allowlist
      // безопаснее ничего не загружать, пока orders/sales не обнаружат нужные nmId.
      if (isScoped(t.productScope) && !t.productScope.allowedNmIds?.length) {
        continue;
      }

      // WB отдаёт остаток по каждому размеру → один (nm_id, warehouse) встречается
      // несколько раз. Схлопываем по ключу апсёрта, суммируя количества (иначе
      // ON CONFLICT падает: «cannot affect row a second time»).
      const agg = new Map<string, { nm_id: number; warehouse: string; quantity: number; in_way_to_client: number; in_way_from_client: number; cabinet_id: string | null; synced_at: string }>();
      const stamp = new Date().toISOString();
      try {
        for await (const stocks of wbWarehouseStockPages({
          token: t.statsToken,
          nmIds: t.productScope.allowedNmIds,
        })) {
          for (const s of stocks) {
            if (!allowsProduct(t.productScope, s.nmId)) continue;
            const nm_id = s.nmId;
            const warehouse = s.warehouseName;
            if (!nm_id || !warehouse) continue;
            const key = `${nm_id}|${warehouse}`;
            const cur = agg.get(key) ?? { nm_id, warehouse, quantity: 0, in_way_to_client: 0, in_way_from_client: 0, cabinet_id: t.cabinetId, synced_at: stamp };
            cur.quantity += s.quantity ?? 0;
            cur.in_way_to_client += s.inWayToClient ?? 0;
            cur.in_way_from_client += s.inWayFromClient ?? 0;
            agg.set(key, cur);
          }
        }
      } catch (error) {
        const message = error instanceof WbStocksApiError
          ? `WB ${error.status}: ${error.message}`
          : error instanceof Error ? error.message : "Unknown error";
        errors.push(`${t.name}: ${message}`);
        continue;
      }
      const rows = [...agg.values()];

      const upsertError = await chunkedUpsert("wb_stocks", rows, "nm_id,warehouse");
      if (upsertError) {
        errors.push(`${t.name}: ${upsertError}`);
        continue;
      }
      total += rows.length;
    }

    const ok = errors.length === 0;
    await writeSyncLog("stocks", ok ? "ok" : "error", total, errors.join("; ") || null, startedAt);
    return NextResponse.json({ ok, rows: total, cabinets: targets.length, errors });
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : "";
    const msg = (err instanceof Error ? err.message : "Unknown error") + cause;
    await writeSyncLog("stocks", "error", null, msg, startedAt);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
