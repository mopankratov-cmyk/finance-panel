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
const MAX_BATCHES_PER_CABINET_PER_RUN = 4;
// сколько дней истории тянем
const DAYS_BACK = 14;

// fullstats с паузами между батчами может идти дольше дефолта — поднимаем лимит
export const maxDuration = 300;

interface NmStat {
  nmId?: number;
  views?: number;
  clicks?: number;
  sum?: number;
  atbs?: number;
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


interface CampaignNmRow {
  nm_id: number;
  date: string;
  views: number;
  clicks: number;
  spent: number;
  carts: number;
  orders: number;
  orders_sum: number;
  cabinet_id: string | null;
}

/** Фолбэк без слоя кампаний: прежний агрегат из строк текущего среза. */
function aggregateNmDaily(rows: CampaignNmRow[], cabinetId: string | null) {
  const byKey = new Map<string, Record<string, unknown> & { views: number; clicks: number; spent: number; carts: number; orders: number; orders_sum: number }>();
  for (const row of rows) {
    const key = `${row.nm_id}|${row.date}`;
    const agg = byKey.get(key) ?? { nm_id: row.nm_id, date: row.date, views: 0, clicks: 0, spent: 0, carts: 0, orders: 0, orders_sum: 0, cabinet_id: cabinetId, synced_at: new Date().toISOString() };
    agg.views += row.views; agg.clicks += row.clicks; agg.spent += row.spent;
    agg.carts += row.carts; agg.orders += row.orders; agg.orders_sum += row.orders_sum;
    byKey.set(key, agg);
  }
  return [...byKey.values()];
}

/**
 * Полная пересборка витрины по затронутым (nm, день): суммируем ВСЕ кампании
 * артикула из слоя, а не кампании одного среза. Именно частичная сумма из
 * одного среза и давала «нули при включённой РК».
 */
async function rebuildNmDailyFromCampaigns(
  db: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  cabinetId: string | null,
  touched: CampaignNmRow[],
  from: string,
  to: string,
) {
  const nmIds = [...new Set(touched.map((row) => row.nm_id))];
  if (!nmIds.length) return [];
  const all: CampaignNmRow[] = [];
  for (let index = 0; index < nmIds.length; index += 200) {
    const chunk = nmIds.slice(index, index + 200);
    let query = db
      .from("wb_advert_nm_campaign_daily")
      .select("nm_id, date, views, clicks, spent, carts, orders, orders_sum, cabinet_id")
      .gte("date", from)
      .lte("date", to)
      .in("nm_id", chunk)
      .order("nm_id", { ascending: true })
      .order("date", { ascending: true })
      .limit(50_000);
    query = cabinetId === null ? query.is("cabinet_id", null) : query.eq("cabinet_id", cabinetId);
    const { data, error } = await query;
    if (error) throw new Error(`Пересборка витрины рекламы: ${error.message}`);
    all.push(...((data ?? []) as CampaignNmRow[]));
  }
  return aggregateNmDaily(all, cabinetId);
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

  // ?from=YYYY-MM-DD&to=YYYY-MM-DD — принудительный период. Без них берём
  // привычное окно: у только что подключённого кабинета первые дни месяца
  // оказываются за его пределами, и показы по ним остаются пустыми навсегда —
  // рекламная статистика, в отличие от воронки, назад сама не догружается.
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const fromParam = request.nextUrl.searchParams.get("from");
  const toParam = request.nextUrl.searchParams.get("to");
  if ((fromParam && !DATE.test(fromParam)) || (toParam && !DATE.test(toParam))) {
    return NextResponse.json({ error: "Даты периода задаются как ГГГГ-ММ-ДД" }, { status: 400 });
  }
  const end = toParam ? new Date(`${toParam}T00:00:00.000Z`) : new Date();
  const begin = fromParam
    ? new Date(`${fromParam}T00:00:00.000Z`)
    : new Date(Date.now() - DAYS_BACK * 86400000);
  if (begin > end) {
    return NextResponse.json({ error: "Дата начала позже даты окончания" }, { status: 400 });
  }
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  let advertDays = 0;
  let nmDays = 0;
  const errors: string[] = [];
  const rotated: string[] = [];
  const progress: Array<Record<string, unknown>> = [];

  // До четырёх fullstats-батчей на кабинет с обязательным интервалом WB 20с.
  // 300с хватает четырём кабинетам, а при общем seller порядок приоритета
  // каждый час сдвигается, поэтому один большой кабинет не блокирует остальные.
  const deadline = Date.now() + 280_000;
  const hourIndex = Math.floor(Date.now() / 3_600_000);
  const targetOffset = onlyCabinet || targets.length < 2 ? 0 : hourIndex % targets.length;
  const orderedTargets = [...targets.slice(targetOffset), ...targets.slice(0, targetOffset)];

  try {
    for (const t of orderedTargets) {
      if (Date.now() > deadline) { rotated.push(`${t.name}: пропущен (бюджет)`); break; } // докрутим следующим прогоном
      const previous = t.cabinetId ? await readWbSyncState(db, t.cabinetId, "advert-stats") : null;
      if (t.cabinetId && !(await claimWbSyncJob(db, t.cabinetId, "advert-stats", 6 * 60))) {
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
      // По-кампанийный слой: ключ (кампания, nm, день). Каждый срез fullstats
      // полон для своих кампаний, поэтому такой upsert никогда не затирает
      // данные кампаний из других срезов. Прежний агрегат «nm за день из
      // кампаний ТЕКУЩЕГО среза» перезаписывал полную сумму частичной, когда
      // артикул размазан по кампаниям из разных срезов — отсюда мигающие нули
      // при включённой РК.
      const campaignDaily = new Map<string, { advert_id: number; nm_id: number; date: string; views: number; clicks: number; spent: number; carts: number; orders: number; orders_sum: number; cabinet_id: string | null }>();

      // Батчи кампаний: каждый почасовой прогон берёт следующий срез.
      const idBatches: number[][] = [];
      for (let i = 0; i < ids.length; i += ID_BATCH) idBatches.push(ids.slice(i, i + ID_BATCH));
      const savedBatch = Number(previous?.state.nextBatch);
      const startB = idBatches.length
        ? (Number.isInteger(savedBatch) && savedBatch >= 0 ? savedBatch : hourIndex) % idBatches.length
        : 0;
      if (idBatches.length > 1) rotated.push(`${t.name}: срез ${startB + 1}/${idBatches.length}`);

      let failedMessage: string | null = null;
      let deferredMessage: string | null = null;
      let nextBatchOnFailure: number | null = null;
      const processedBatches: number[][] = [];
      for (let k = 0; k < idBatches.length; k++) {
        if (Date.now() > deadline) break; // тайм-бокс: остальное доберём следующим прогоном
        if (processedBatches.length >= MAX_BATCHES_PER_CABINET_PER_RUN) break;
        const batchIndex = (startB + k) % idBatches.length;
        const batch = idBatches[batchIndex];

        const url = new URL(FULLSTATS_URL);
        url.searchParams.set("ids", batch.join(","));
        url.searchParams.set("beginDate", fmt(begin));
        url.searchParams.set("endDate", fmt(end));

        const res = await fetchWbStatistics({
          url: url.toString(),
          token: t.advertToken,
          deadline,
          fallbackWaitMs: 20_000,
        });
        if (!res.ok) {
          const message = `WB ${res.status}: ${(await res.text()).slice(0, 120)}`;
          if (isWbAdvertRateLimit(res.status, message)) {
            rotated.push(`${t.name}: лимит WB fullstats, повторим срез ${batchIndex + 1}/${idBatches.length || 1}`);
            deferredMessage = message;
            nextBatchOnFailure = batchIndex;
            break;
          }
          errors.push(`${t.name}: ${message}`);
          failedMessage = message;
          nextBatchOnFailure = batchIndex;
          break;
        }

        const stats = ((await res.json()) ?? []) as AdvertStat[];
        processedBatches.push(batch);
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
                const key = `${adv.advertId}|${nm.nmId}|${date}`;
                const agg = campaignDaily.get(key) ?? {
                  advert_id: adv.advertId,
                  nm_id: nm.nmId,
                  date,
                  views: 0,
                  clicks: 0,
                  spent: 0,
                  carts: 0,
                  orders: 0,
                  orders_sum: 0,
                  cabinet_id: t.cabinetId,
                };
                agg.views += nm.views ?? 0;
                agg.clicks += nm.clicks ?? 0;
                agg.spent += nm.sum ?? 0;
                agg.carts += nm.atbs ?? 0;
                agg.orders += nm.orders ?? 0;
                agg.orders_sum += nm.sum_price ?? 0;
                campaignDaily.set(key, agg);
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
        // Завершаем текущий цикл ровно на последнем батче. Следующий запуск
        // начнёт новый круг с нуля и coverage не смешает два разных круга.
        if (batchIndex === idBatches.length - 1) break;
      }

      if (!processedBatches.length && (failedMessage || deferredMessage)) {
        const nextBatch = nextBatchOnFailure ?? startB;
        if (t.cabinetId) await writeWbSyncState(db, t.cabinetId, "advert-stats", {
          cursor: String(nextBatch),
          // Запрос этого кабинета уже завершён: pending сохраняет курсор, но
          // освобождает lease для немедленного cron/ручного продолжения.
          status: failedMessage ? "error" : "pending",
          attempts: failedMessage ? (previous?.attempts ?? 0) + 1 : 0,
          lastError: failedMessage,
          state: {
            ...(previous?.state ?? {}),
            nextBatch,
            totalBatches: idBatches.length,
            totalCampaigns: ids.length,
            ...(deferredMessage ? { lastRateLimitedAt: new Date().toISOString() } : {}),
          },
        });
        progress.push({ cabinet: t.name, status: failedMessage ? "error" : "rate_limited", batch: nextBatch + 1, batches: idBatches.length, nextBatch });
        continue;
      }

      const campaignRows = [...campaignDaily.values()].map((r) => ({ ...r, synced_at: new Date().toISOString() }));

      const e1 = await chunkedUpsert("wb_advert_stats", dayRows, "cabinet_id,advert_id,date");
      if (e1) {
        errors.push(`${t.name}: ${e1}`);
        if (t.cabinetId) await writeWbSyncState(db, t.cabinetId, "advert-stats", {
          cursor: String(startB), status: "error", attempts: (previous?.attempts ?? 0) + 1, lastError: e1,
          state: { ...(previous?.state ?? {}), nextBatch: startB, totalBatches: idBatches.length, totalCampaigns: ids.length },
        });
        continue;
      }
      const e0 = await chunkedUpsert(
        "wb_advert_nm_campaign_daily",
        campaignRows,
        // Constraint unique nulls not distinct — см. миграцию слоя.
        "cabinet_id,advert_id,nm_id,date",
      );
      // Молча глушим ровно один случай — отсутствующую ТАБЛИЦУ слоя (миграция
      // ещё не применена). Прежняя проверка ловила любое «does not exist», и
      // частично применённая миграция (нет колонки, нет constraint) уходила в
      // тишину: синк рапортовал ok, а слой оставался пустым.
      const layerMissing = /42P01|relation .*wb_advert_nm_campaign_daily.* does not exist|Could not find the table/i.test(e0 ?? "");
      if (e0 && !layerMissing) {
        errors.push(`${t.name}: слой кампаний: ${e0}`);
      }
      // Витрина по артикулу пересобирается из ВСЕХ кампаний затронутых
      // (nm, день) — а не из кампаний одного среза. Пока миграция слоя не
      // применена, живёт прежний (мигающий) агрегат — честная деградация.
      let nmRows: ReturnType<typeof aggregateNmDaily>;
      if (e0) {
        // Слой не записался — витрина собирается прежним (мигающим) агрегатом.
        nmRows = aggregateNmDaily(campaignRows, t.cabinetId);
      } else {
        try {
          nmRows = await rebuildNmDailyFromCampaigns(db, t.cabinetId, campaignRows, fmt(begin), fmt(end));
        } catch (cause) {
          errors.push(`${t.name}: ${cause instanceof Error ? cause.message : String(cause)}`);
          nmRows = aggregateNmDaily(campaignRows, t.cabinetId);
        }
      }
      const e2 = await chunkedUpsert("wb_advert_nm_daily", nmRows, "cabinet_id,nm_id,date");
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
      const processedCampaignIds = processedBatches.flat();
      if (processedCampaignIds.length) {
        let update = db.from("wb_adverts").update({ last_stats_synced_at: syncedAt }).in("advert_id", processedCampaignIds);
        update = t.cabinetId === null ? update.is("cabinet_id", null) : update.eq("cabinet_id", t.cabinetId);
        await update;
      }
      const nextBatch = nextBatchOnFailure ?? (idBatches.length ? (startB + processedBatches.length) % idBatches.length : 0);
      const previousProcessed = Number(previous?.state.cycleProcessed ?? 0);
      const cycleProcessed = nextBatch === 0 ? ids.length : Math.min(ids.length, previousProcessed + processedCampaignIds.length);
      const coveragePct = ids.length ? Math.round(cycleProcessed / ids.length * 1_000) / 10 : 100;
      if (t.cabinetId) {
        const stateError = await writeWbSyncState(db, t.cabinetId, "advert-stats", {
          cursor: String(nextBatch),
          status: failedMessage ? "error" : nextBatch === 0 ? "caught_up" : "pending",
          attempts: failedMessage ? (previous?.attempts ?? 0) + 1 : 0,
          lastError: failedMessage,
          state: {
            nextBatch,
            totalBatches: idBatches.length,
            totalCampaigns: ids.length,
            cycleProcessed: nextBatch === 0 ? 0 : cycleProcessed,
            coveragePct,
            lastSyncedAt: syncedAt,
            ...(deferredMessage ? { lastRateLimitedAt: syncedAt } : {}),
          },
        });
        if (stateError) errors.push(`${t.name}: состояние advert-stats: ${stateError}`);
      }
      progress.push({
        cabinet: t.name,
        status: failedMessage ? "error" : deferredMessage ? "rate_limited" : nextBatch === 0 ? "caught_up" : "pending",
        batch: startB + 1,
        batches: idBatches.length,
        batchesProcessed: processedBatches.length,
        campaigns: processedCampaignIds.length,
        coveragePct,
        nextBatch,
      });
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
