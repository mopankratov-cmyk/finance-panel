import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets, lastSyncDate, rememberScopedProducts } from "@/lib/sync/cabinets";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { allowsProduct } from "@/lib/wb/productScope";
import { initialStatisticsCursor, readWbSyncState, statisticsCursor, writeWbSyncState } from "@/lib/wb/syncRecovery";
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
  const progress: Array<Record<string, unknown>> = [];
  const db = getSupabaseAdmin();

  try {
    for (const t of targets) {
      const saved = !forceFrom && db && t.cabinetId
        ? await readWbSyncState(db, t.cabinetId, "sales")
        : null;
      const existingDate = !forceFrom && !saved
        ? await lastSyncDate("wb_sales", t.cabinetId)
        : null;
      const dateFrom = forceFrom
        ? new Date(forceFrom).toISOString().slice(0, 19)
        : saved?.cursor
          ?? (existingDate ? new Date(existingDate).toISOString().slice(0, 19) : initialStatisticsCursor());

      const url = new URL("https://statistics-api.wildberries.ru/api/v1/supplier/sales");
      url.searchParams.set("dateFrom", dateFrom);
      url.searchParams.set("flag", "0");

      const res = await fetchWbStatistics({ url: url.toString(), token: t.statsToken, deadline });
      if (!res.ok) {
        errors.push(`${t.name}: WB ${res.status}: ${(await res.text()).slice(0, 120)}`);
        continue;
      }

      const sales: Record<string, unknown>[] = await res.json();
      scanned += sales.length;
      if (sales.length) await rememberScopedProducts(t, sales);

      const rows = sales
        .filter((s) => allowsProduct(t.productScope, s.nmId, s.brand))
        .map((s) => ({
          sale_id: s.saleID as string,
          nm_id: s.nmId as number,
          date: s.date as string,
          for_pay: s.forPay as number | null,
          finished_price: s.finishedPrice as number | null,
          // цена до СПП: priceWithDisc, иначе totalPrice×(1−disc%)
          price_with_disc: (s.priceWithDisc as number | null) ?? (s.totalPrice != null ? Number(s.totalPrice) * (1 - Number(s.discountPercent ?? 0) / 100) : null),
          cabinet_id: t.cabinetId,
          synced_at: new Date().toISOString(),
        }))
        .filter((r) => r.sale_id)
        .filter((r) => !toDate || String(r.date) < toDate);

      const upsertError = await chunkedUpsert("wb_sales", rows, "sale_id", forceFrom ? 100_000 : undefined);
      if (upsertError) {
        errors.push(`${t.name}: ${upsertError}`);
        continue;
      }
      total += rows.length;

      const nextCursor = sales.length
        ? statisticsCursor(sales, dateFrom)
        : new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const caughtUp = sales.length < 80_000;
      let stateError: string | null = null;
      if (!forceFrom && db && t.cabinetId) {
        stateError = await writeWbSyncState(db, t.cabinetId, "sales", {
          cursor: nextCursor,
          status: caughtUp ? "caught_up" : "backfill",
          attempts: 0,
          lastError: null,
          state: { scanned: sales.length, caughtUp, lastRunAt: new Date().toISOString() },
        });
      }
      if (stateError) errors.push(`${t.name}: состояние sales: ${stateError}`);
      progress.push({ cabinet: t.name, scanned: sales.length, matched: rows.length, cursor: nextCursor, caughtUp, stateError });
    }

    const ok = errors.length === 0;
    await writeSyncLog("sales", ok ? "ok" : "error", total, errors.join("; ") || null, startedAt);
    return NextResponse.json({ ok, rows: total, scanned, cabinets: targets.length, progress, errors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await writeSyncLog("sales", "error", null, msg, startedAt);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
