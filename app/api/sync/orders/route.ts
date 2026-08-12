import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, chunkedUpsertWithOptionalColumns, writeSyncLog } from "@/lib/sync/helpers";
import {
  getWbSyncTargets,
  groupWbStatisticsTargets,
  lastSyncDate,
  rememberScopedProducts,
  type SyncTarget,
} from "@/lib/sync/cabinets";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { allowsProduct } from "@/lib/wb/productScope";
import { isWbGlobalRateLimit } from "@/lib/wb/rateLimit";
import { initialStatisticsCursor, statisticsCursor } from "@/lib/wb/syncRecovery";
import { claimWbSyncJob, readWbSyncState, writeWbSyncState, type WbSyncState } from "@/lib/wb/syncState";
import { fetchWbStatistics } from "@/lib/wb/statisticsRequest";

export const maxDuration = 60; // глубокий бэкфилл (?from=) пишет десятки тысяч строк

interface OrdersSyncContext {
  target: SyncTarget;
  saved: WbSyncState | null;
  dateFrom: string;
}

function numericOrNull(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function priceWithDiscFromOrder(order: Record<string, unknown>): number | null {
  const direct = numericOrNull(order.priceWithDisc);
  if (direct !== null) return direct;
  const totalPrice = numericOrNull(order.totalPrice);
  if (totalPrice === null) return null;
  const discount = numericOrNull(order.discountPercent) ?? 0;
  return totalPrice * (1 - discount / 100);
}

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
  const deferred: string[] = [];
  const progress: Array<Record<string, unknown>> = [];
  const db = getSupabaseAdmin();

  try {
    for (const sourceTargets of groupWbStatisticsTargets(targets)) {
      const contexts: OrdersSyncContext[] = [];
      for (const target of sourceTargets) {
        const saved = !forceFrom && db && target.cabinetId
          ? await readWbSyncState(db, target.cabinetId, "orders")
          : null;
        const existingDate = !forceFrom && !saved
          ? await lastSyncDate("wb_orders", target.cabinetId)
          : null;
        const dateFrom = forceFrom
          ? new Date(forceFrom).toISOString().slice(0, 19)
          : saved?.cursor
            ?? (existingDate ? new Date(existingDate).toISOString().slice(0, 19) : initialStatisticsCursor());
        if (!forceFrom && db && target.cabinetId && !(await claimWbSyncJob(db, target.cabinetId, "orders", 15 * 60))) {
          progress.push({ cabinet: target.name, status: "running", skipped: true });
          continue;
        }
        contexts.push({ target, saved, dateFrom });
      }
      if (!contexts.length) continue;

      // Берём самый ранний курсор группы: один ответ WB затем безопасно
      // фильтруется и записывается во все виртуальные кабинеты продавца.
      const dateFrom = contexts.reduce((oldest, context) => context.dateFrom < oldest ? context.dateFrom : oldest, contexts[0].dateFrom);

      const url = new URL("https://statistics-api.wildberries.ru/api/v1/supplier/orders");
      url.searchParams.set("dateFrom", dateFrom);
      url.searchParams.set("flag", "0");

      const res = await fetchWbStatistics({ url: url.toString(), token: contexts[0].target.statsToken, deadline });
      if (!res.ok) {
        const message = `WB ${res.status}: ${(await res.text()).slice(0, 120)}`;
        const rateLimited = isWbGlobalRateLimit(res.status, message);
        const nowIso = new Date().toISOString();
        for (const context of contexts) {
          const { target, saved } = context;
          if (rateLimited) {
            deferred.push(`${target.name}: ${message}`);
            progress.push({ cabinet: target.name, status: "deferred", reason: "wb_global_rate_limit", cursor: context.dateFrom });
          } else {
            errors.push(`${target.name}: ${message}`);
          }
          if (!forceFrom && db && target.cabinetId) await writeWbSyncState(db, target.cabinetId, "orders", {
            cursor: context.dateFrom,
            status: rateLimited ? "running" : "error",
            attempts: rateLimited ? 0 : (saved?.attempts ?? 0) + 1,
            lastError: message,
            state: {
              ...(saved?.state ?? {}),
              historyStart: saved?.state.historyStart ?? context.dateFrom,
              ...(rateLimited ? { lastRateLimitedAt: nowIso } : {}),
              lastRunAt: nowIso,
            },
          });
        }
        continue;
      }

      const orders: Record<string, unknown>[] = await res.json();
      scanned += orders.length;
      const nextCursor = orders.length
        ? statisticsCursor(orders, dateFrom)
        : new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const caughtUp = orders.length < 80_000;
      for (const context of contexts) {
        const { target, saved } = context;
        if (orders.length) await rememberScopedProducts(target, orders);
        const syncedAt = new Date().toISOString();
        const rows = orders
          .filter((order) => allowsProduct(target.productScope, order.nmId, order.brand))
          .map((order) => ({
            srid: order.srid as string,
            nm_id: order.nmId as number,
            supplier_article: order.supplierArticle as string | null,
            date: order.date as string,
            total_price: order.totalPrice as number | null,
            discount_percent: order.discountPercent as number | null,
            finished_price: order.finishedPrice as number | null,
            price_with_disc: priceWithDiscFromOrder(order),
            spp: numericOrNull(order.spp),
            is_cancel: (order.isCancel as boolean) ?? false,
            warehouse: order.warehouseName as string | null,
            // Сырой тип склада WB — единственный достоверный признак схемы отгрузки.
            warehouse_type: (order.warehouseType as string | null) ?? null,
            region: order.regionName as string | null,
            cabinet_id: target.cabinetId,
            synced_at: syncedAt,
          }))
          .filter((row) => row.srid)
          .filter((row) => !toDate || String(row.date) < toDate);
        const upsertResult = await chunkedUpsertWithOptionalColumns("wb_orders", rows, "srid", ["price_with_disc", "spp", "warehouse_type"], forceFrom ? 100_000 : undefined);
        if (upsertResult.skippedColumns.length) {
          deferred.push(`${target.name}: примените SQL-миграцию WB СПП, временно не записаны ${upsertResult.skippedColumns.join(", ")}`);
        }
        const upsertError = upsertResult.error;
        if (upsertError) {
          errors.push(`${target.name}: ${upsertError}`);
          if (!forceFrom && db && target.cabinetId) await writeWbSyncState(db, target.cabinetId, "orders", {
            cursor: context.dateFrom,
            status: "error",
            attempts: (saved?.attempts ?? 0) + 1,
            lastError: upsertError,
            state: { ...(saved?.state ?? {}), historyStart: saved?.state.historyStart ?? context.dateFrom, lastRunAt: syncedAt },
          });
          continue;
        }
        total += rows.length;
        let stateError: string | null = null;
        if (!forceFrom && db && target.cabinetId) {
          stateError = await writeWbSyncState(db, target.cabinetId, "orders", {
            cursor: nextCursor,
            status: caughtUp ? "caught_up" : "backfill",
            attempts: 0,
            lastError: null,
            state: {
              historyStart: saved?.state.historyStart ?? context.dateFrom,
              lastRowDate: nextCursor,
              rowsLoaded: Number(saved?.state.rowsLoaded ?? 0) + rows.length,
              scanned: orders.length,
              caughtUp,
              coveragePct: caughtUp ? 100 : 0,
              lastSyncedAt: syncedAt,
              lastRunAt: syncedAt,
            },
          });
        }
        if (stateError) errors.push(`${target.name}: состояние orders: ${stateError}`);
        progress.push({ cabinet: target.name, scanned: orders.length, matched: rows.length, cursor: nextCursor, caughtUp, sharedRequest: contexts.length > 1, stateError });
      }
    }

    const ok = errors.length === 0;
    await writeSyncLog("orders", ok ? "ok" : "error", total, errors.join("; ") || null, startedAt);
    return NextResponse.json({ ok, rows: total, scanned, cabinets: targets.length, progress, errors, deferred });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await writeSyncLog("orders", "error", null, msg, startedAt);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
