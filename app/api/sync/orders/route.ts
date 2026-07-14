import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets, lastSyncDate, rememberScopedProducts } from "@/lib/sync/cabinets";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { allowsProduct } from "@/lib/wb/productScope";
import { initialStatisticsCursor, statisticsCursor } from "@/lib/wb/syncRecovery";
import { claimWbSyncJob, readWbSyncState, writeWbSyncState } from "@/lib/wb/syncState";
import { fetchWbStatistics } from "@/lib/wb/statisticsRequest";

export const maxDuration = 60; // глубокий бэкфилл (?from=) пишет десятки тысяч строк

export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const deadline = Date.now() + 50_000;
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
      const existingDate = !forceFrom && !saved
        ? await lastSyncDate("wb_orders", t.cabinetId)
        : null;
      const dateFrom = forceFrom
        ? new Date(forceFrom).toISOString().slice(0, 19)
        : saved?.cursor
          ?? (existingDate ? new Date(existingDate).toISOString().slice(0, 19) : initialStatisticsCursor());
      if (!forceFrom && db && t.cabinetId && !(await claimWbSyncJob(db, t.cabinetId, "orders", 15 * 60))) {
        progress.push({ cabinet: t.name, status: "running", skipped: true });
        continue;
      }

      const url = new URL("https://statistics-api.wildberries.ru/api/v1/supplier/orders");
      url.searchParams.set("dateFrom", dateFrom);
      url.searchParams.set("flag", "0");

      const res = await fetchWbStatistics({ url: url.toString(), token: t.statsToken, deadline });
      if (!res.ok) {
        const message = `WB ${res.status}: ${(await res.text()).slice(0, 120)}`;
        errors.push(`${t.name}: ${message}`);
        if (!forceFrom && db && t.cabinetId) await writeWbSyncState(db, t.cabinetId, "orders", {
          cursor: dateFrom,
          status: "error",
          attempts: (saved?.attempts ?? 0) + 1,
          lastError: message,
          state: { ...(saved?.state ?? {}), historyStart: saved?.state.historyStart ?? dateFrom, lastRunAt: new Date().toISOString() },
        });
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
        if (!forceFrom && db && t.cabinetId) await writeWbSyncState(db, t.cabinetId, "orders", {
          cursor: dateFrom,
          status: "error",
          attempts: (saved?.attempts ?? 0) + 1,
          lastError: upsertError,
          state: { ...(saved?.state ?? {}), historyStart: saved?.state.historyStart ?? dateFrom, lastRunAt: new Date().toISOString() },
        });
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
          state: {
            historyStart: saved?.state.historyStart ?? dateFrom,
            lastRowDate: nextCursor,
            rowsLoaded: Number(saved?.state.rowsLoaded ?? 0) + rows.length,
            scanned: orders.length,
            caughtUp,
            coveragePct: caughtUp ? 100 : 0,
            lastRunAt: new Date().toISOString(),
          },
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
