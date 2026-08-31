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
import { initialStatisticsCursor, statisticsCursor, statisticsRequestCursor } from "@/lib/wb/syncRecovery";
import { claimWbSyncJob, readWbSyncState, writeWbSyncState, type WbSyncState } from "@/lib/wb/syncState";
import { fetchWbStatistics } from "@/lib/wb/statisticsRequest";

export const maxDuration = 60; // глубокий бэкфилл (?from=) пишет десятки тысяч строк

interface SalesSyncContext {
  target: SyncTarget;
  saved: WbSyncState | null;
  dateFrom: string;
}

function numericOrNull(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function priceWithDiscFromSale(sale: Record<string, unknown>): number | null {
  const direct = numericOrNull(sale.priceWithDisc);
  if (direct !== null) return direct;
  const totalPrice = numericOrNull(sale.totalPrice);
  if (totalPrice === null) return null;
  const discount = numericOrNull(sale.discountPercent) ?? 0;
  return totalPrice * (1 - discount / 100);
}

export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const deadline = Date.now() + 50_000;
  const allTargets = await getWbSyncTargets();
  if (!allTargets.length) {
    return NextResponse.json({ error: "Нет активных кабинетов и WB_STATS_TOKEN не настроен" }, { status: 500 });
  }

  const sp = new URL(request.url).searchParams;
  // ?from=YYYY-MM-DD — принудительный ре-синк с даты (бэкфилл price_with_disc)
  const forceFrom = sp.get("from");
  // ?to=YYYY-MM-DD — верхняя граница (WB не умеет dateTo, режем у себя): окно [from, to)
  const toDate = sp.get("to");
  // ?cabinet=<uuid> — один кабинет за вызов (большие объёмы влезают в 60с)
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
      const contexts: SalesSyncContext[] = [];
      for (const target of sourceTargets) {
        const saved = !forceFrom && db && target.cabinetId
          ? await readWbSyncState(db, target.cabinetId, "sales")
          : null;
        const existingDate = !forceFrom && !saved
          ? await lastSyncDate("wb_sales", target.cabinetId)
          : null;
        const dateFrom = forceFrom
          ? new Date(forceFrom).toISOString().slice(0, 19)
          : saved?.cursor
            ?? (existingDate ? new Date(existingDate).toISOString().slice(0, 19) : initialStatisticsCursor());
        if (!forceFrom && db && target.cabinetId && !(await claimWbSyncJob(db, target.cabinetId, "sales", 15 * 60))) {
          progress.push({ cabinet: target.name, status: "running", skipped: true });
          continue;
        }
        contexts.push({ target, saved, dateFrom });
      }
      if (!contexts.length) continue;

      const dateFrom = contexts.reduce((oldest, context) => context.dateFrom < oldest ? context.dateFrom : oldest, contexts[0].dateFrom);

      // Спрашиваем с ПЕРЕХЛЁСТОМ: WB публикует часть строк задним числом, с
      // lastChangeDate старше сохранённого курсора, и без перехлёста такую
      // строку не запросят уже никогда. Принудительный ре-синк перехлёста не
      // требует — там окно задал человек.
      const requestFrom = forceFrom ? dateFrom : statisticsRequestCursor(dateFrom);
      const url = new URL("https://statistics-api.wildberries.ru/api/v1/supplier/sales");
      url.searchParams.set("dateFrom", requestFrom);
      url.searchParams.set("flag", "0");

      const res = await fetchWbStatistics({ url: url.toString(), token: contexts[0].target.statsToken, deadline });
      if (!res.ok) {
        const message = `WB ${res.status}: ${(await res.text()).slice(0, 120)}`;
        if (isWbGlobalRateLimit(res.status, message)) {
          const nowIso = new Date().toISOString();
          for (const context of contexts) {
            const { target, saved } = context;
            deferred.push(`${target.name}: ${message}`);
            if (!forceFrom && db && target.cabinetId) {
              await writeWbSyncState(db, target.cabinetId, "sales", {
                cursor: context.dateFrom,
                status: "running",
                attempts: 0,
                lastError: message,
                state: {
                  ...(saved?.state ?? {}),
                  historyStart: saved?.state.historyStart ?? context.dateFrom,
                  lastRateLimitedAt: nowIso,
                  lastRunAt: nowIso,
                },
              });
            }
            progress.push({ cabinet: target.name, status: "deferred", reason: "wb_global_rate_limit", cursor: context.dateFrom });
          }
          continue;
        }
        for (const context of contexts) {
          const { target, saved } = context;
          errors.push(`${target.name}: ${message}`);
          if (!forceFrom && db && target.cabinetId) await writeWbSyncState(db, target.cabinetId, "sales", {
            cursor: context.dateFrom,
            status: "error",
            attempts: (saved?.attempts ?? 0) + 1,
            lastError: message,
            state: { ...(saved?.state ?? {}), historyStart: saved?.state.historyStart ?? context.dateFrom, lastRunAt: new Date().toISOString() },
          });
        }
        continue;
      }

      const sales: Record<string, unknown>[] = await res.json();
      scanned += sales.length;
      // Пустой ответ раньше двигал курсор на «сейчас минус два часа» и писал
      // «догнан на 100%». Одна такая осечка — и продажи за пропущенные дни не
      // соберутся уже никогда, при том что ВОЗВРАТЫ за те же дни приходят
      // следующими прогонами. В РНП это выглядит как отрицательные выкупы:
      // из нуля известных продаж вычитаются пришедшие возвраты.
      const nextCursor = sales.length ? statisticsCursor(sales, dateFrom) : null;
      const caughtUp = sales.length < 80_000;
      for (const context of contexts) {
        const { target, saved } = context;
        if (sales.length) await rememberScopedProducts(target, sales);
        const syncedAt = new Date().toISOString();
        const rows = sales
          .filter((sale) => allowsProduct(target.productScope, sale.nmId, sale.brand))
          .map((sale) => ({
            sale_id: sale.saleID as string,
            nm_id: sale.nmId as number,
            date: sale.date as string,
            for_pay: sale.forPay as number | null,
            finished_price: sale.finishedPrice as number | null,
            // цена до СПП: priceWithDisc, иначе totalPrice×(1−disc%)
            price_with_disc: priceWithDiscFromSale(sale),
            spp: numericOrNull(sale.spp),
            warehouse_type: (sale.warehouseType as string | null) ?? null,
            // srid связывает возврат со сборочным заданием: без него сверка КИЗ
            // вынуждена спрашивать возвраты у WB живьём, а там лимит один
            // запрос в минуту на продавца.
            srid: ((sale.srid as string | null) ?? "").trim() || null,
            cabinet_id: target.cabinetId,
            synced_at: syncedAt,
          }))
          .filter((row) => row.sale_id)
          .filter((row) => !toDate || String(row.date) < toDate);
        const upsertResult = await chunkedUpsertWithOptionalColumns("wb_sales", rows, "sale_id", ["price_with_disc", "spp", "warehouse_type", "srid"], forceFrom ? 100_000 : undefined);
        if (upsertResult.skippedColumns.length) {
          deferred.push(`${target.name}: примените SQL-миграцию WB СПП, временно не записаны ${upsertResult.skippedColumns.join(", ")}`);
        }
        const upsertError = upsertResult.error;
        if (upsertError) {
          errors.push(`${target.name}: ${upsertError}`);
          if (!forceFrom && db && target.cabinetId) await writeWbSyncState(db, target.cabinetId, "sales", {
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
          const cursorToWrite = nextCursor ?? saved?.cursor ?? context.dateFrom;
          stateError = await writeWbSyncState(db, target.cabinetId, "sales", {
            cursor: cursorToWrite,
            status: caughtUp ? "caught_up" : "backfill",
            attempts: 0,
            lastError: null,
            state: {
              historyStart: saved?.state.historyStart ?? context.dateFrom,
              lastRowDate: cursorToWrite,
              rowsLoaded: Number(saved?.state.rowsLoaded ?? 0) + rows.length,
              scanned: sales.length,
              caughtUp,
              coveragePct: caughtUp ? 100 : 0,
              lastSyncedAt: syncedAt,
              lastRunAt: syncedAt,
            },
          });
        }
        if (stateError) errors.push(`${target.name}: состояние sales: ${stateError}`);
        progress.push({ cabinet: target.name, scanned: sales.length, matched: rows.length, cursor: nextCursor ?? saved?.cursor ?? context.dateFrom, caughtUp, sharedRequest: contexts.length > 1, stateError });
      }
    }

    // То же правило, что и в заказах: нулевой сбор при отложенных кабинетах —
    // не успех. Зелёный журнал при пустых экранах не заставляет никого
    // разбираться, и час без продаж проходит незамеченным.
    const nothingCollected = total === 0 && scanned === 0;
    const allDeferred = deferred.length > 0 && nothingCollected;
    const ok = errors.length === 0 && !allDeferred;
    const logNote = errors.join("; ")
      || (allDeferred ? `данные не обновлены: ${deferred.join("; ")}` : null);
    await writeSyncLog("sales", ok ? "ok" : "error", total, logNote, startedAt);
    return NextResponse.json({
      ok,
      rows: total,
      scanned,
      cabinets: targets.length,
      progress,
      errors,
      deferred,
      ...(allDeferred ? { error: `WB ограничил запросы, продажи не обновлены: ${deferred[0]}` } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await writeSyncLog("sales", "error", null, msg, startedAt);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
