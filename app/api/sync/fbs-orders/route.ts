import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets } from "@/lib/sync/cabinets";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { allowsNm } from "@/lib/wb/productScope";
import { readWbSyncState, writeWbSyncState } from "@/lib/wb/syncState";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// FBS-заказы из Marketplace API — единственный достоверный признак схемы продажи.
// warehouseType в статистике метит «Складом продавца» и FBO-отгрузки из транзитных
// СЦ (сверка с кабинетом 2026-08-17), поэтому сплит по нему отключён; здесь — прямой
// факт: сборочное задание Marketplace существует только у FBS-заказа.
//
// srid статистики соответствует rid сборочного задания — по нему заказы из
// wb_orders опознаются как FBS при сборке РНП.
const ORDERS_URL = "https://marketplace-api.wildberries.ru/api/v3/orders";
const PAGE_LIMIT = 1000;
// Стартовое окно покрывает месячный экран РНП с запасом.
const INITIAL_DAYS = 35;
const JOB = "fbs-orders";

interface MarketplaceOrder {
  rid?: string;
  nmId?: number;
  createdAt?: string;
}

export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;
  const startedAt = new Date();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const sp = request.nextUrl.searchParams;
  const onlyCabinet = sp.get("cabinet");
  // ?from=YYYY-MM-DD — принудительное окно (бэкфилл истории кабинета).
  const forceFrom = sp.get("from");
  if (forceFrom && !/^\d{4}-\d{2}-\d{2}$/.test(forceFrom)) {
    return NextResponse.json({ error: "Некорректный параметр from" }, { status: 400 });
  }
  const allTargets = await getWbSyncTargets();
  const targets = (onlyCabinet ? allTargets.filter((target) => target.cabinetId === onlyCabinet) : allTargets)
    .filter((target) => target.cabinetId);
  if (!targets.length) return NextResponse.json({ error: "Нет активных кабинетов" }, { status: 404 });

  let total = 0;
  const errors: string[] = [];
  const progress: Array<Record<string, unknown>> = [];

  for (const target of targets) {
    const cabinetId = target.cabinetId!;
    try {
      const saved = forceFrom ? null : await readWbSyncState(db, cabinetId, JOB);
      // Дозапись с перехлёстом: сборочное задание может появиться позже создания
      // заказа, поэтому каждый прогон перечитывает последние два дня курсора.
      const cursorMs = saved?.cursor ? Date.parse(saved.cursor) - 2 * 86_400_000 : NaN;
      const fromMs = forceFrom
        ? Date.parse(`${forceFrom}T00:00:00Z`)
        : Number.isFinite(cursorMs)
          ? cursorMs
          : startedAt.getTime() - INITIAL_DAYS * 86_400_000;
      const rows: Array<Record<string, unknown>> = [];
      let next = 0;
      let newestMs = fromMs;
      for (let page = 0; page < 60; page++) {
        const url = new URL(ORDERS_URL);
        url.searchParams.set("limit", String(PAGE_LIMIT));
        url.searchParams.set("next", String(next));
        url.searchParams.set("dateFrom", String(Math.floor(fromMs / 1000)));
        url.searchParams.set("dateTo", String(Math.floor(startedAt.getTime() / 1000)));
        let response = await fetch(url, { headers: { Authorization: target.statsToken }, cache: "no-store" });
        // Глобальный лимитер продавца: тем же Marketplace API пользуется его
        // собственный сервис. Пара повторов с паузой часто проскакивает окно.
        for (let attempt = 0; response.status === 429 && attempt < 2; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 15_000));
          response = await fetch(url, { headers: { Authorization: target.statsToken }, cache: "no-store" });
        }
        if (!response.ok) {
          throw new Error(`WB ${response.status}: ${(await response.text()).slice(0, 120)}`);
        }
        const json = (await response.json()) as { next?: number; orders?: MarketplaceOrder[] };
        const orders = json.orders ?? [];
        for (const order of orders) {
          const srid = String(order.rid ?? "").trim();
          const nmId = Number(order.nmId);
          if (!srid || !Number.isFinite(nmId)) continue;
          if (!allowsNm(target.productScope, nmId)) continue;
          const createdMs = order.createdAt ? Date.parse(order.createdAt) : NaN;
          if (Number.isFinite(createdMs) && createdMs > newestMs) newestMs = createdMs;
          rows.push({
            cabinet_id: cabinetId,
            srid,
            nm_id: nmId,
            created_at_wb: order.createdAt ?? null,
            synced_at: startedAt.toISOString(),
          });
        }
        next = Number(json.next ?? 0);
        if (orders.length < PAGE_LIMIT || !next) break;
      }

      const upsertError = rows.length ? await chunkedUpsert("wb_fbs_orders", rows, "cabinet_id,srid") : null;
      if (upsertError) throw new Error(upsertError);
      total += rows.length;
      // Принудительное окно тоже двигает состояние: период фактически покрыт,
      // и без записи покрытия РНП молчал бы, хотя факты уже в базе.
      const existing = forceFrom ? await readWbSyncState(db, cabinetId, JOB) : saved;
      const coveredCandidates = [String(existing?.state.coveredFrom ?? ""), new Date(fromMs).toISOString().slice(0, 10)]
        .filter(Boolean)
        .sort();
      const cursorCandidates = [String(existing?.cursor ?? ""), new Date(newestMs).toISOString()].filter(Boolean).sort();
      await writeWbSyncState(db, cabinetId, JOB, {
        cursor: cursorCandidates[cursorCandidates.length - 1],
        status: "caught_up",
        attempts: 0,
        lastError: null,
        state: {
          coveredFrom: coveredCandidates[0],
          lastRunAt: startedAt.toISOString(),
          rows: rows.length,
        },
      });
      progress.push({ cabinet: target.name, rows: rows.length, status: "caught_up" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "неизвестная ошибка";
      errors.push(`${target.name}: ${message}`);
      if (!forceFrom) {
        const saved = await readWbSyncState(db, cabinetId, JOB);
        await writeWbSyncState(db, cabinetId, JOB, {
          cursor: saved?.cursor ?? null,
          status: "error",
          attempts: (saved?.attempts ?? 0) + 1,
          lastError: message,
          state: saved?.state ?? {},
        });
      }
      progress.push({ cabinet: target.name, status: "error", error: message });
    }
  }

  const ok = errors.length === 0;
  await writeSyncLog(JOB, ok ? "ok" : "error", total, errors.join("; ") || null, startedAt);
  // error дублирует errors первой строкой: бэкфилл показывает именно его.
  return NextResponse.json(
    { ok, rows: total, cabinets: targets.length, progress, errors, error: errors[0] ?? undefined },
    { status: ok ? 200 : 502 },
  );
}
