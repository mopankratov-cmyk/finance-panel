import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets, rememberScopedProducts } from "@/lib/sync/cabinets";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { allowsProduct } from "@/lib/wb/productScope";
import { initialStatisticsCursor, readWbSyncState, statisticsCursor, writeWbSyncState } from "@/lib/wb/syncRecovery";

export const maxDuration = 60; // глубокий бэкфилл (?from=) пишет десятки тысяч строк

export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const allTargets = await getWbSyncTargets();
  if (!allTargets.length) {
    return NextResponse.json({ error: "Нет активных кабинетов и WB_STATS_TOKEN не настроен" }, { status: 500 });
  }

  const sp = new URL(request.url).searchParams;
  // ?from=YYYY-MM-DD — принудительный бэкфилл истории заказов с даты.
  // Без него продолжаем по lastChangeDate — это единственный корректный курсор WB.
  const forceFrom = sp.get("from");
  // ?to=YYYY-MM-DD — верхняя граница (WB не умеет dateTo, режем на своей стороне): окно [from, to).
  const toDate = sp.get("to");
  // ?cabinet=<uuid> — бэкфиллить один кабинет за вызов (большие объёмы влезают в 60с).
  const onlyCab = sp.get("cabinet");
  const targets = onlyCab ? allTargets.filter((t) => t.cabinetId === onlyCab) : allTargets;
  if (!targets.length) {
    return NextResponse.json({ error: `Кабинет не найден: ${onlyCab}` }, { status: 404 });
  }

  let total = 0;
  let scanned = 0;
  const errors: string[] = [];
  const progress: Array<Record<string, unknown>> = [];
  const db = getSupabaseAdmin();

  try {
    for (const t of targets) {
      const saved = !forceFrom && db && t.cabinetId
        ? await readWbSyncState(db, t.cabinetId, "orders")
        : null;
      const dateFrom = forceFrom
        ? new Date(forceFrom).toISOString().slice(0, 19)
        : saved?.cursor ?? initialStatisticsCursor();

      const url = new URL("https://statistics-api.wildberries.ru/api/v1/supplier/orders");
      url.searchParams.set("dateFrom", dateFrom);
      url.searchParams.set("flag", "0");

      const res = await fetch(url.toString(), { headers: { Authorization: t.statsToken }, cache: "no-store" });
      if (!res.ok) {
        errors.push(`${t.name}: WB ${res.status}: ${(await res.text()).slice(0, 120)}`);
        continue;
      }

      const orders: Record<string, unknown>[] = await res.json();
      scanned += orders.length;
      if (orders.length) await rememberScopedProducts(t, orders);

      const rows = orders
        .filter((o) => allowsProduct(t.productScope, o.nmId, o.brand))
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
        .filter((r) => r.srid)
        .filter((r) => !toDate || String(r.date) < toDate);

      const upsertError = await chunkedUpsert("wb_orders", rows, "srid", forceFrom ? 100_000 : undefined);
      if (upsertError) {
        errors.push(`${t.name}: ${upsertError}`);
        continue;
      }
      total += rows.length;

      const nextCursor = orders.length
        ? statisticsCursor(orders, dateFrom)
        : new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const caughtUp = orders.length < 80_000;
      let stateError: string | null = null;
      if (!forceFrom && db && t.cabinetId) {
        stateError = await writeWbSyncState(db, t.cabinetId, "orders", {
          cursor: nextCursor,
          status: caughtUp ? "caught_up" : "backfill",
          attempts: 0,
          lastError: null,
          state: { scanned: orders.length, caughtUp, lastRunAt: new Date().toISOString() },
        });
      }
      if (stateError) errors.push(`${t.name}: состояние orders: ${stateError}`);
      progress.push({ cabinet: t.name, scanned: orders.length, matched: rows.length, cursor: nextCursor, caughtUp, stateError });
    }

    const ok = errors.length === 0;
    await writeSyncLog("orders", ok ? "ok" : "error", total, errors.join("; ") || null, startedAt);
    return NextResponse.json({ ok, rows: total, scanned, cabinets: targets.length, progress, errors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await writeSyncLog("orders", "error", null, msg, startedAt);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
