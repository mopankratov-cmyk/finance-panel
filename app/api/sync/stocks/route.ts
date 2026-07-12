import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets, rememberScopedProducts } from "@/lib/sync/cabinets";
import { allowsProduct } from "@/lib/wb/productScope";

export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const targets = await getWbSyncTargets();
  if (!targets.length) {
    return NextResponse.json({ error: "Нет активных кабинетов и WB_STATS_TOKEN не настроен" }, { status: 500 });
  }

  // Остатки — всегда полный снимок, берём за сутки
  const dateFrom = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 19);

  let total = 0;
  const errors: string[] = [];

  try {
    for (const t of targets) {
      const url = new URL("https://statistics-api.wildberries.ru/api/v1/supplier/stocks");
      url.searchParams.set("dateFrom", dateFrom);

      const res = await fetch(url.toString(), { headers: { Authorization: t.statsToken }, cache: "no-store" });
      if (!res.ok) {
        errors.push(`${t.name}: WB ${res.status}: ${(await res.text()).slice(0, 120)}`);
        continue;
      }

      const stocks: Record<string, unknown>[] = await res.json();
      if (!stocks.length) continue;
      await rememberScopedProducts(t, stocks);

      // WB отдаёт остаток по каждому размеру → один (nm_id, warehouse) встречается
      // несколько раз. Схлопываем по ключу апсёрта, суммируя количества (иначе
      // ON CONFLICT падает: «cannot affect row a second time»).
      const agg = new Map<string, { nm_id: number; warehouse: string; quantity: number; in_way_to_client: number; in_way_from_client: number; cabinet_id: string | null; synced_at: string }>();
      const stamp = new Date().toISOString();
      for (const s of stocks) {
        if (!allowsProduct(t.productScope, s.nmId, s.brand)) continue;
        const nm_id = s.nmId as number;
        const warehouse = s.warehouseName as string;
        if (!nm_id || !warehouse) continue;
        const key = `${nm_id}|${warehouse}`;
        const cur = agg.get(key) ?? { nm_id, warehouse, quantity: 0, in_way_to_client: 0, in_way_from_client: 0, cabinet_id: t.cabinetId, synced_at: stamp };
        cur.quantity += (s.quantity as number) ?? 0;
        cur.in_way_to_client += (s.inWayToClient as number) ?? 0;
        cur.in_way_from_client += (s.inWayFromClient as number) ?? 0;
        agg.set(key, cur);
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
