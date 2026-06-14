import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets } from "@/lib/sync/cabinets";

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

      const rows = stocks
        .map((s) => ({
          nm_id: s.nmId as number,
          warehouse: s.warehouseName as string,
          quantity: s.quantity as number | null,
          in_way_to_client: s.inWayToClient as number | null,
          in_way_from_client: s.inWayFromClient as number | null,
          cabinet_id: t.cabinetId,
          synced_at: new Date().toISOString(),
        }))
        .filter((r) => r.nm_id && r.warehouse);

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
