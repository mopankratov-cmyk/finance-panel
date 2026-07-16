import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets } from "@/lib/sync/cabinets";
import { isWbAdvertRateLimit } from "@/lib/wb/advertRateLimit";
import { allowsNm, isScoped } from "@/lib/wb/productScope";
import { claimWbSyncJob, readWbSyncState, writeWbSyncState } from "@/lib/wb/syncState";
import { fetchWbStatistics } from "@/lib/wb/statisticsRequest";

const FULLSTATS_URL = "https://advert-api.wildberries.ru/adv/v3/fullstats";
// fullstats: до 50 кампаний за раз (WB 400 при >50).
const ID_BATCH = 50;
// сколько дней истории тянем
const DAYS_BACK = 14;

// fullstats с паузами между батчами может идти дольше дефолта — поднимаем лимит
export const maxDuration = 60;

interface NmStat {
  nmId?: number;
  views?: number;
  clicks?: number;
  sum?: number;
  orders?: number;
  sum_price?: number;
}
interface AppStat {
  nms?: NmStat[];
}
interface DayStat {
  date?: string;
  views?: number;
  clicks?: number;
  ctr?: number;
  cpc?: number;
  sum?: number;
  orders?: number;
  sum_price?: number;
  apps?: AppStat[];
}
interface AdvertStat {
  advertId?: number;
  days?: DayStat[];
}

export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const allTargets = await getWbSyncTargets();
  const onlyCabinet = request.nextUrl.searchParams.get("cabinet");
  const targets = onlyCabinet ? allTargets.filter((target) => target.cabinetId === onlyCabinet) : allTargets;
  if (!targets.length) {
    return NextResponse.json({ error: "Нет активных кабинетов и WB_TOKEN_ADVERT не настроен" }, { status: 500 });
  }

  const end = new Date();
  const begin = new Date(Date.now() - DAYS_BACK * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  let advertDays = 0;
  let nmDays = 0;
  const errors: string[] = [];
  const rotated: string[] = [];
  const progress: Array<Record<string, unknown>> = [];

  // Тайм-бокс на 60с-функцию + почасовая ротация среза кампаний.
  const deadline = Date.now() + 50_000;
  const hourIndex = Math.floor(Date.now() / 3_600_000);

  try {
    for (const t of targets) {
      if (Date.now() > deadline) { rotated.push(`${t.name}: пропущен (бюджет)`); break; } // докрутим следующим прогоном
      const previous = t.cabinetId ? await readWbSyncState(db, t.cabinetId, "advert-stats") : null;
      if (t.cabinetId && !(await claimWbSyncJob(db, t.cabinetId, "advert-stats", 15 * 60))) {
        rotated.push(`${t.name}: уже выполняется`);
        continue;
      }
      // Fullstats отдаёт активные, приостановленные и завершённые кампании.
      let aq = db
        .from("wb_adverts")
        .select("advert_id, status")
        .in("status", [7, 9, 11])
        .order("advert_id", { ascending: true });
      aq = t.cabinetId === null ? aq.is("cabinet_id", null) : aq.eq("cabinet_id", t.cabinetId);
      if (isScoped(t.productScope)) {
        const allowedNmIds = [...new Set(t.productScope.allowedNmIds ?? [])];
        aq = aq.overlaps("nm_ids", allowedNmIds);
      }
      const { data: advRows, error: advErr } = await aq;
      if (advErr) {
        errors.push(`${t.name}: ${advErr.message}`);
        if (t.cabinetId) await writeWbSyncState(db, t.cabinetId, "advert-stats", {
          cursor: previous?.cursor ?? null,
          status: "error",
          attempts: (previous?.attempts ?? 0) + 1,
          lastError: advErr.message,
          state: previous?.state ?? {},
        });
        continue;
      }

      const ids = (advRows ?? []).map((r) => r.advert_id as number);
      if (!ids.length) {
        if (t.cabinetId) await writeWbSyncState(db, t.cabinetId, "advert-stats", {
          cursor: "0",
          status: "caught_up",
          attempts: 0,
          lastError: null,
          state: { nextBatch: 0, totalBatches: 0, totalCampaigns: 0, cycleProcessed: 0, coveragePct: 100, lastSyncedAt: new Date().toISOString() },
        });
        progress.push({ cabinet: t.name, batches: 0, campaigns: 0, coveragePct: 100, nextBatch: 0 });
        continue;
      }

      const dayRows: Record<string, unknown>[] = [];
      const nmDaily = new Map<string, { nm_id: number; date: string; views: number; clicks: number; spent: number; orders: number; orders_sum: number; cabinet_id: string | null }>();

      // Батчи кампаний: каждый почасовой прогон берёт следующий срез.
      const idBatches: number[][] = [];
      for (let i = 0; i < ids.length; i += ID_BATCH) idBatches.push(ids.slice(i, i + ID_BATCH));
      const savedBatch = Number(previous?.state.nextBatch);
      const startB = idBatches.length
        ? (Number.isInteger(savedBatch) && savedBatch >= 0 ? savedBatch : hourIndex) % idBatches.length
        : 0;
      if (idBatches.length > 1) rotated.push(`${t.name}: срез ${startB + 1}/${idBatches.length}`);

      let failed = false;
      let deferred = false;
      let processed = 0;
      for (let k = 0; k < idBatches.length; k++) {
        if (Date.now() > deadline) break; // тайм-бокс: остальное доберём следующим прогоном
        // следующий батч ТОГО ЖЕ кабинета требует паузу 61с (WB 1 req/min) — она одна не влезает
        // в 60с-функцию, поэтому за прогон берём максимум 1 батч на кабинет, остальное — ротацией по дням
        if (processed > 0) break;
        const batch = idBatches[(startB + k) % idBatches.length];
        processed++;

        const url = new URL(FULLSTATS_URL);
        url.searchParams.set("ids", batch.join(","));
        url.searchParams.set("beginDate", fmt(begin));
        url.searchParams.set("endDate", fmt(end));

        const res = await fetchWbStatistics({
          url: url.toString(),
          token: t.advertToken,
          deadline,
          fallbackWaitMs: 1_000,
        });
        if (!res.ok) {
          const message = `WB ${res.status}: ${(await res.text()).slice(0, 120)}`;
          if (isWbAdvertRateLimit(res.status, message)) {
            rotated.push(`${t.name}: лимит WB fullstats, повторим срез ${startB + 1}/${idBatches.length || 1}`);
            if (t.cabinetId) await writeWbSyncState(db, t.cabinetId, "advert-stats", {
              cursor: String(startB),
              status: "running",
              attempts: 0,
              lastError: null,
              state: {
                ...(previous?.state ?? {}),
                nextBatch: startB,
                totalBatches: idBatches.length,
                totalCampaigns: ids.length,
                lastRateLimitedAt: new Date().toISOString(),
              },
            });
            progress.push({ cabinet: t.name, status: "rate_limited", batch: startB + 1, batches: idBatches.length, nextBatch: startB });
            deferred = true;
            break;
          }
          errors.push(`${t.name}: ${message}`);
          if (t.cabinetId) await writeWbSyncState(db, t.cabinetId, "advert-stats", {
            cursor: String(startB),
            status: "error",
            attempts: (previous?.attempts ?? 0) + 1,
            lastError: message,
            state: { ...(previous?.state ?? {}), nextBatch: startB, totalBatches: idBatches.length, totalCampaigns: ids.length },
          });
          failed = true;
          break;
        }

        const stats = ((await res.json()) ?? []) as AdvertStat[];
        for (const adv of stats) {
          if (!adv.advertId || !adv.days) continue;
          for (const day of adv.days) {
            if (!day.date) continue;
            const date = day.date.slice(0, 10);
            let scopedViews = 0, scopedClicks = 0, scopedSpent = 0, scopedOrders = 0, scopedOrdersSum = 0;
            let hasAllowedNm = false;

            for (const app of day.apps ?? []) {
              for (const nm of app.nms ?? []) {
                if (!nm.nmId) continue;
                if (!allowsNm(t.productScope, nm.nmId)) continue;
                hasAllowedNm = true;
                scopedViews += nm.views ?? 0;
                scopedClicks += nm.clicks ?? 0;
                scopedSpent += nm.sum ?? 0;
                scopedOrders += nm.orders ?? 0;
                scopedOrdersSum += nm.sum_price ?? 0;
                const key = `${nm.nmId}|${date}`;
                const agg = nmDaily.get(key) ?? {
                  nm_id: nm.nmId,
                  date,
                  views: 0,
                  clicks: 0,
                  spent: 0,
                  orders: 0,
                  orders_sum: 0,
                  cabinet_id: t.cabinetId,
                };
                agg.views += nm.views ?? 0;
                agg.clicks += nm.clicks ?? 0;
                agg.spent += nm.sum ?? 0;
                agg.orders += nm.orders ?? 0;
                agg.orders_sum += nm.sum_price ?? 0;
                nmDaily.set(key, agg);
              }
            }

            if (isScoped(t.productScope) && !hasAllowedNm) continue;
            const views = isScoped(t.productScope) ? scopedViews : (day.views ?? 0);
            const clicks = isScoped(t.productScope) ? scopedClicks : (day.clicks ?? 0);
            const spent = isScoped(t.productScope) ? scopedSpent : (day.sum ?? 0);
            dayRows.push({
              advert_id: adv.advertId,
              date,
              views,
              clicks,
              ctr: isScoped(t.productScope) ? (views > 0 ? clicks / views * 100 : 0) : (day.ctr ?? null),
              cpc: isScoped(t.productScope) ? (clicks > 0 ? spent / clicks : 0) : (day.cpc ?? null),
              sum_spent: spent,
              orders: isScoped(t.productScope) ? scopedOrders : (day.orders ?? 0),
              sum_orders: isScoped(t.productScope) ? scopedOrdersSum : (day.sum_price ?? 0),
              cabinet_id: t.cabinetId,
            });
          }
        }
      }
      if (failed || deferred) continue;

      const nmRows = [...nmDaily.values()].map((r) => ({ ...r, synced_at: new Date().toISOString() }));

      const e1 = await chunkedUpsert("wb_advert_stats", dayRows, "advert_id,date");
      if (e1) {
        errors.push(`${t.name}: ${e1}`);
        if (t.cabinetId) await writeWbSyncState(db, t.cabinetId, "advert-stats", {
          cursor: String(startB), status: "error", attempts: (previous?.attempts ?? 0) + 1, lastError: e1,
          state: { ...(previous?.state ?? {}), nextBatch: startB, totalBatches: idBatches.length, totalCampaigns: ids.length },
        });
        continue;
      }
      const e2 = await chunkedUpsert("wb_advert_nm_daily", nmRows, "nm_id,date");
      if (e2) {
        errors.push(`${t.name}: ${e2}`);
        if (t.cabinetId) await writeWbSyncState(db, t.cabinetId, "advert-stats", {
          cursor: String(startB), status: "error", attempts: (previous?.attempts ?? 0) + 1, lastError: e2,
          state: { ...(previous?.state ?? {}), nextBatch: startB, totalBatches: idBatches.length, totalCampaigns: ids.length },
        });
        continue;
      }
      advertDays += dayRows.length;
      nmDays += nmRows.length;
      const syncedAt = new Date().toISOString();
      const batch = idBatches[startB] ?? [];
      if (batch.length) {
        let update = db.from("wb_adverts").update({ last_stats_synced_at: syncedAt }).in("advert_id", batch);
        update = t.cabinetId === null ? update.is("cabinet_id", null) : update.eq("cabinet_id", t.cabinetId);
        await update;
      }
      const nextBatch = idBatches.length ? (startB + 1) % idBatches.length : 0;
      const previousProcessed = Number(previous?.state.cycleProcessed ?? 0);
      const cycleProcessed = nextBatch === 0 ? ids.length : Math.min(ids.length, previousProcessed + batch.length);
      const coveragePct = ids.length ? Math.round(cycleProcessed / ids.length * 1_000) / 10 : 100;
      if (t.cabinetId) {
        const stateError = await writeWbSyncState(db, t.cabinetId, "advert-stats", {
          cursor: String(nextBatch),
          status: nextBatch === 0 ? "caught_up" : "running",
          attempts: 0,
          lastError: null,
          state: {
            nextBatch,
            totalBatches: idBatches.length,
            totalCampaigns: ids.length,
            cycleProcessed: nextBatch === 0 ? 0 : cycleProcessed,
            coveragePct,
            lastSyncedAt: syncedAt,
          },
        });
        if (stateError) errors.push(`${t.name}: состояние advert-stats: ${stateError}`);
      }
      progress.push({ cabinet: t.name, batch: startB + 1, batches: idBatches.length, campaigns: batch.length, coveragePct, nextBatch });
    }

    const ok = errors.length === 0;
    const note = rotated.length ? ` [ротация: ${rotated.join(", ")}]` : "";
    await writeSyncLog("advert-stats", ok ? "ok" : "error", advertDays, errors.length ? (errors.join("; ") + note).trim() : null, startedAt);
    return NextResponse.json({ ok, advertDays, nmDays, cabinets: targets.length, progress, rotated, errors });
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : "";
    const msg = (err instanceof Error ? err.message : "Unknown error") + cause;
    await writeSyncLog("advert-stats", "error", null, msg, startedAt);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
