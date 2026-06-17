import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets, lastSyncDate } from "@/lib/sync/cabinets";

export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const targets = await getWbSyncTargets();
  if (!targets.length) {
    return NextResponse.json({ error: "Нет активных кабинетов и WB_STATS_TOKEN не настроен" }, { status: 500 });
  }

  // ?from=YYYY-MM-DD — принудительный бэкфилл истории заказов с даты (общий для всех кабинетов).
  // Без него — инкрементально от последней даты в таблице, иначе 30 дней назад (первый синк).
  const forceFrom = new URL(request.url).searchParams.get("from");

  let total = 0;
  const errors: string[] = [];

  try {
    for (const t of targets) {
      const last = forceFrom ? null : await lastSyncDate("wb_orders", t.cabinetId);
      const dateFrom = forceFrom
        ? new Date(forceFrom).toISOString().slice(0, 19)
        : last
          ? new Date(last).toISOString().slice(0, 19)
          : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19);

      const url = new URL("https://statistics-api.wildberries.ru/api/v1/supplier/orders");
      url.searchParams.set("dateFrom", dateFrom);
      url.searchParams.set("flag", "0");

      const res = await fetch(url.toString(), { headers: { Authorization: t.statsToken }, cache: "no-store" });
      if (!res.ok) {
        errors.push(`${t.name}: WB ${res.status}: ${(await res.text()).slice(0, 120)}`);
        continue;
      }

      const orders: Record<string, unknown>[] = await res.json();
      if (!orders.length) continue;

      const rows = orders
        .map((o) => ({
          srid: o.srid as string,
          nm_id: o.nmId as number,
          supplier_article: o.supplierArticle as string | null,
          date: o.date as string,
          total_price: o.totalPrice as number | null,
          discount_percent: o.discountPercent as number | null,
          finished_price: o.finishedPrice as number | null,
          is_cancel: (o.isCancel as boolean) ?? false,
          warehouse: o.warehouseName as string | null,
          region: o.regionName as string | null,
          cabinet_id: t.cabinetId,
          synced_at: new Date().toISOString(),
        }))
        .filter((r) => r.srid);

      const upsertError = await chunkedUpsert("wb_orders", rows, "srid");
      if (upsertError) {
        errors.push(`${t.name}: ${upsertError}`);
        continue;
      }
      total += rows.length;
    }

    const ok = errors.length === 0;
    await writeSyncLog("orders", ok ? "ok" : "error", total, errors.join("; ") || null, startedAt);
    return NextResponse.json({ ok, rows: total, cabinets: targets.length, errors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await writeSyncLog("orders", "error", null, msg, startedAt);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
