import { NextRequest, NextResponse } from "next/server";
import { calculateAdvertProfitGuardrail, compareAdvertBeforeAfter } from "@/lib/adverts/profitGuardrails";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { wbCardImageUrl } from "@/lib/wb/cardImage";
import { getWbCommissionForCabinet } from "@/lib/wb/commissions";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { getActiveWbCabinets, getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { requestAllowedNmIds, requestAllowsNm } from "@/lib/wb/requestProductScope";
import { buildAdvertWorkingDaySummary, type AdvertDayPoint } from "@/lib/adverts/daySummary";
import { loadScopedAdvertReportRows } from "@/lib/adverts/scopedReport";
import { aggregateClosedAdvertMetrics, getClosedMoscowPeriod } from "@/lib/adverts/closedPeriodMetrics";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { loadRnpReportRows } from "@/lib/rnp/rpcLoaders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ADV_BASE = "https://advert-api.wildberries.ru";
const CAMPAIGN_PAGE_SIZE = 1000;
const CAMPAIGN_MAX_PAGES = 30;
const CAMPAIGN_PAGE_CONCURRENCY = 6;
// Статистика кампаний — самая большая выборка экрана (кампании × 15 дней,
// у Оптимы ~65 страниц по 1000 строк): без пачек она листалась ~10 секунд.
const STATS_PAGE_CONCURRENCY = 8;

interface RpcRow {
  nm_id: number;
  article: string;
  orders_month: number;
  orders_sum_month: number;
  stock: number;
  in_way_to_client: number;
  cost: number | null;
}
interface StatRow {
  advert_id: number;
  date: string;
  sum_spent: number;
  views: number;
  clicks: number;
  sum_orders: number;
}
interface NmDailyRow {
  cabinet_id: string | null;
  nm_id: number;
  date: string;
  spent: number;
}
interface FunnelDayRow {
  cabinet_id: string | null;
  nm_id: number;
  date: string;
  open_card: number | null;
  add_to_cart: number | null;
  orders: number | null;
  orders_sum: number | null;
}
interface ChangeRow {
  advert_id: number;
  old_bid: number | null;
  new_bid: number | null;
  status: string;
  created_at: string;
}
interface AdvertRow {
  advert_id: number;
  cabinet_id: string | null;
  name: string | null;
  status: number;
  daily_budget: number | null;
  bid_cpm_rub?: number | null;
  last_stats_synced_at?: string | null;
  nm_ids: number[] | null;
}

interface CampaignPageError {
  message: string;
  code?: string;
}

interface CampaignPage<Row> {
  data: Row[] | null;
  error: CampaignPageError | null;
}

function createCampaignPageError(error: CampaignPageError, label: string): Error & { code?: string } {
  return Object.assign(new Error(`${label}: ${error.message}`), error.code ? { code: error.code } : {});
}

function campaignPageErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function addIsoDays(date: string, days: number) {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

async function loadAllCampaignPages<Row>(
  fetchPage: (from: number, to: number) => PromiseLike<CampaignPage<Row>>,
  label: string,
): Promise<Row[]> {
  const pageSize = CAMPAIGN_PAGE_SIZE;
  const maxPages = CAMPAIGN_MAX_PAGES;
  const rows: Row[] = [];

  // Страницы читаем пачками: у крупного кабинета тысячи кампаний, и
  // последовательные round-trip к БД складывались в секунды.
  for (let page = 0; page < maxPages; page += CAMPAIGN_PAGE_CONCURRENCY) {
    const batchCount = Math.min(CAMPAIGN_PAGE_CONCURRENCY, maxPages - page);
    const results = await Promise.all(Array.from({ length: batchCount }, (_, index) => {
      const from = (page + index) * pageSize;
      return fetchPage(from, from + pageSize - 1);
    }));
    for (const result of results) {
      if (result.error) throw createCampaignPageError(result.error, label);
      const batch = result.data ?? [];
      rows.push(...batch);
      if (batch.length < pageSize) return rows;
    }
  }

  throw new Error(`${label} превысил безопасный лимит ${pageSize * maxPages} строк`);
}

// Контракт inferno: {ok, articles:[{nm,art,photo,spend,campaigns:[{...}]}], balance, count, spend_today_total, spend_yest_total, today, yest, cap_rub}
export async function GET(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" });

  // ?cabinet=<uuid|all> — срез рекламы по выбранному кабинету (данные уже синканы с cabinet_id)
  const searchParams = new URL(request.url).searchParams;
  const { cabinetId, label } = await resolveShopCabinet(searchParams.get("cabinet") ?? undefined);
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ ok: false, error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const [allowedNmIds, activeCabinets] = await Promise.all([
    requestAllowedNmIds(cabinetId),
    cabinetId ? Promise.resolve([]) : getActiveWbCabinets(),
  ]);
  const allowedByCabinet = new Map(activeCabinets
    .filter((cabinet) => cabinet.allowed_nm_ids !== null)
    .map((cabinet) => [cabinet.id, new Set(cabinet.allowed_nm_ids ?? [])]));

  const metricsPeriod7Closed = getClosedMoscowPeriod();
  // «Сегодня/вчера» считаем в московском календаре WB, а не по UTC.
  // dateTo закрытого периода — вчерашний полный день.
  const yest = metricsPeriod7Closed.dateTo;
  const today = addIsoDays(yest, 1);
  const legacyStatsDateFrom = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const statsDateFrom = legacyStatsDateFrom < metricsPeriod7Closed.dateFrom ? legacyStatsDateFrom : metricsPeriod7Closed.dateFrom;
  let changesQ = db.from("advert_bid_changes").select("advert_id, old_bid, new_bid, status, created_at").order("created_at", { ascending: false }).limit(500);
  if (cabinetId) changesQ = changesQ.eq("cabinet_id", cabinetId);

  // ?timings=1 — длительности источников в ответе, чтобы мерить узкие места
  // прямо на проде без пересборки. Данных не раскрывает, роут и так под сессией.
  const wantTimings = searchParams.get("timings") === "1";
  const timings: Record<string, number> = {};
  const timed = <T,>(name: string, promise: Promise<T>): Promise<T> => {
    if (!wantTimings) return promise;
    const startedAt = Date.now();
    const record = () => { timings[name] = Date.now() - startedAt; };
    return promise.then(
      (value) => { record(); return value; },
      (error) => { record(); throw error; },
    );
  };

  const advertRowsPromise = (async (): Promise<AdvertRow[]> => {
    try {
      return await loadAllCampaignPages<AdvertRow>((from, to) => {
        let query = db
          .from("wb_adverts")
          .select("advert_id, cabinet_id, name, status, daily_budget, bid_cpm_rub, last_stats_synced_at, nm_ids")
          .in("status", [7, 9, 11])
          .order("advert_id", { ascending: true })
          .range(from, to);
        if (cabinetId) query = query.eq("cabinet_id", cabinetId);
        return query;
      }, "Рекламные кампании WB");
    } catch (error) {
      if (campaignPageErrorCode(error) !== "42703") throw error;
      return loadAllCampaignPages<AdvertRow>((from, to) => {
        let query = db
          .from("wb_adverts")
          .select("advert_id, cabinet_id, name, status, daily_budget, nm_ids")
          .in("status", [7, 9, 11])
          .order("advert_id", { ascending: true })
          .range(from, to);
        if (cabinetId) query = query.eq("cabinet_id", cabinetId);
        return query;
      }, "Рекламные кампании WB (legacy)");
    }
  })();

  const statRowsPromise = loadAllSupabasePages<StatRow>((from, to) => {
    let query = db
      .from("wb_advert_stats")
      .select("advert_id, date, sum_spent, views, clicks, sum_orders")
      .gte("date", statsDateFrom)
      .order("date", { ascending: true })
      .order("advert_id", { ascending: true })
      .range(from, to);
    if (cabinetId) query = query.eq("cabinet_id", cabinetId);
    return query;
  }, { maxPages: 100, label: "Статистика рекламных кампаний WB", concurrency: STATS_PAGE_CONCURRENCY });

  const nmDailyRowsPromise = loadAllSupabasePages<NmDailyRow>((from, to) => {
    let query = db
      .from("wb_advert_nm_daily")
      .select("cabinet_id, nm_id, date, spent")
      .gte("date", metricsPeriod7Closed.dateFrom)
      .lte("date", metricsPeriod7Closed.dateTo)
      .order("date", { ascending: true })
      .order("nm_id", { ascending: true })
      .range(from, to);
    if (cabinetId) query = query.eq("cabinet_id", cabinetId);
    return query;
  }, { maxPages: 100, label: "Расход рекламы WB по SKU", concurrency: STATS_PAGE_CONCURRENCY });

  const funnelRowsPromise = loadAllSupabasePages<FunnelDayRow>((from, to) => {
    let query = db
      .from("wb_funnel_daily")
      .select("cabinet_id, nm_id, date, open_card, add_to_cart, orders, orders_sum")
      .gte("date", yest)
      .lte("date", today)
      .order("date", { ascending: true })
      .order("nm_id", { ascending: true })
      .range(from, to);
    if (cabinetId) query = query.eq("cabinet_id", cabinetId);
    return query;
  }, { maxPages: 100, label: "Воронка WB для сводки рекламы", concurrency: 4 });

  // Баланс продвижения зависит только от cabinetId — считаем его цепочку параллельно
  // с тяжёлыми БД-запросами, а не после них (иначе латентность складывается).
  const balancePromise: Promise<number | null> = cabinetId
    ? getWbCabinet(cabinetId).then(async (cab) => {
        const advToken = cab ? resolveWbToken(cab, "advert") : null;
        if (!advToken) return null;
        try {
          const res = await fetch(`${ADV_BASE}/adv/v1/balance`, {
            headers: { Authorization: advToken },
            cache: "no-store",
            signal: AbortSignal.timeout(5_000),
          });
          if (!res.ok) return null;
          const j = await res.json();
          return (j.balance ?? 0) + (j.net ?? 0);
        } catch {
          return null;
        }
      })
    : Promise.resolve(null);

  const reportPromise: Promise<RpcRow[]> = cabinetId && allowedNmIds
    ? loadScopedAdvertReportRows(db, cabinetId, [...allowedNmIds])
    : loadRnpReportRows<RpcRow>(db, cabinetId, {
        label: "Реклама WB: товары",
      });

  let queryResults: [
    AdvertRow[],
    StatRow[],
    NmDailyRow[],
    FunnelDayRow[],
    RpcRow[],
    Awaited<typeof changesQ>,
    Awaited<ReturnType<typeof getWbCommissionForCabinet>>,
    number | null,
  ] | null = null;
  try {
    queryResults = await Promise.all([
      timed("adverts", advertRowsPromise),
      timed("stats", statRowsPromise),
      timed("nm_daily", nmDailyRowsPromise),
      timed("funnel", funnelRowsPromise),
      timed("report", reportPromise),
      timed("changes", Promise.resolve(changesQ)),
      timed("commission", getWbCommissionForCabinet(cabinetId, 30, { allowLiveFallback: false })),
      timed("balance", balancePromise),
    ]);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Не удалось загрузить рекламу WB" },
      { status: 500 },
    );
  }
  const [advertRows, statRows, nmDailyRows, funnelRows, reportRows, changesRes, commission, balance] = queryResults;

  // агрегаты по кампании за 14д + spend today/yest
  const byAdv = new Map<number, { spent14: number; views: number; clicks: number; ordSum: number; today: number; yest: number }>();
  const statRowsByAdvert = new Map<number, StatRow[]>();
  const daysByAdv = new Map<number, AdvertDayPoint[]>();
  for (const s of statRows) {
    const groupedRows = statRowsByAdvert.get(s.advert_id) ?? [];
    groupedRows.push(s);
    statRowsByAdvert.set(s.advert_id, groupedRows);
    const a = byAdv.get(s.advert_id) ?? { spent14: 0, views: 0, clicks: 0, ordSum: 0, today: 0, yest: 0 };
    a.spent14 += Number(s.sum_spent ?? 0);
    a.views += Number(s.views ?? 0);
    a.clicks += Number(s.clicks ?? 0);
    a.ordSum += Number(s.sum_orders ?? 0);
    const d = String(s.date).slice(0, 10);
    if (d === today) a.today += Number(s.sum_spent ?? 0);
    if (d === yest) a.yest += Number(s.sum_spent ?? 0);
    byAdv.set(s.advert_id, a);
    const arr = daysByAdv.get(s.advert_id) ?? [];
    arr.push({
      ts: String(s.date).slice(0, 10),
      spend: Math.round(Number(s.sum_spent ?? 0)),
      clicks: Number(s.clicks ?? 0),
      views: Number(s.views ?? 0),
      orders: Number(s.sum_orders ?? 0),
    });
    daysByAdv.set(s.advert_id, arr);
  }
  for (const arr of daysByAdv.values()) arr.sort((a, b) => a.ts.localeCompare(b.ts));

  const closedMetricsByAdv = new Map<number, ReturnType<typeof aggregateClosedAdvertMetrics>>();
  for (const [advertId, rows] of statRowsByAdvert) {
    closedMetricsByAdv.set(advertId, aggregateClosedAdvertMetrics(rows, metricsPeriod7Closed));
  }

  const skuSpend7ClosedByNm = new Map<number, number>();
  for (const row of nmDailyRows) {
    const rowAllowedNmIds = cabinetId
      ? allowedNmIds
      : (allowedByCabinet.get(String(row.cabinet_id ?? "")) ?? null);
    if (!requestAllowsNm(rowAllowedNmIds, row.nm_id)) continue;
    skuSpend7ClosedByNm.set(row.nm_id, (skuSpend7ClosedByNm.get(row.nm_id) ?? 0) + Number(row.spent ?? 0));
  }

  const funnelByNmDate = new Map<string, { openCard: number; carts: number; ordersCount: number; ordersSum: number }>();
  for (const row of funnelRows) {
    const rowAllowedNmIds = cabinetId
      ? allowedNmIds
      : (allowedByCabinet.get(String(row.cabinet_id ?? "")) ?? null);
    if (!requestAllowsNm(rowAllowedNmIds, row.nm_id)) continue;
    const date = String(row.date).slice(0, 10);
    const key = `${row.nm_id}:${date}`;
    const current = funnelByNmDate.get(key) ?? { openCard: 0, carts: 0, ordersCount: 0, ordersSum: 0 };
    current.openCard += Number(row.open_card ?? 0);
    current.carts += Number(row.add_to_cart ?? 0);
    current.ordersCount += Number(row.orders ?? 0);
    current.ordersSum += Number(row.orders_sum ?? 0);
    funnelByNmDate.set(key, current);
  }

  const artByNm = new Map<number, string>();
  const reportByNm = new Map<number, RpcRow>();
  for (const row of reportRows) {
    if (!requestAllowsNm(allowedNmIds, row.nm_id)) continue;
    artByNm.set(row.nm_id, row.article);
    reportByNm.set(row.nm_id, row);
  }

  const latestChangeByAdvert = new Map<number, ChangeRow>();
  for (const change of (changesRes.data ?? []) as ChangeRow[]) {
    if (!latestChangeByAdvert.has(change.advert_id) && change.status === "success") {
      latestChangeByAdvert.set(change.advert_id, change);
    }
  }

  const cabLabel = label || "Все кабинеты";

  // группируем кампании по основному nm → article. spendYestTotal считаем в ТОМ ЖЕ
  // проходе и над той же популяцией (только кампании с nm), что и spendTodayTotal —
  // иначе «% к вчера» сравнивает разные множества кампаний.
  const artMap = new Map<number, { nm: number; art: string; photo: string; spend: number; spent_sku_7_closed: number; campaigns: Record<string, unknown>[] }>();
  let spendYestTotal = 0;
  for (const a of advertRows) {
    const nmIds = (a.nm_ids as number[]) ?? [];
    const nm = nmIds[0];
    const rowAllowedNmIds = cabinetId
      ? allowedNmIds
      : (allowedByCabinet.get(String(a.cabinet_id ?? "")) ?? null);
    if (!nm || !requestAllowsNm(rowAllowedNmIds, nm)) continue;
    const st = byAdv.get(a.advert_id) ?? { spent14: 0, views: 0, clicks: 0, ordSum: 0, today: 0, yest: 0 };
    const closed = closedMetricsByAdv.get(a.advert_id) ?? aggregateClosedAdvertMetrics([], metricsPeriod7Closed);
    spendYestTotal += st.yest;
    const report = reportByNm.get(nm);
    const rate = commission.byNm.get(nm);
    const price = Number(report?.orders_month ?? 0) > 0
      ? Number(report?.orders_sum_month ?? 0) / Number(report?.orders_month ?? 0)
      : 0;
    const latestStatDate = (daysByAdv.get(a.advert_id) ?? []).at(-1)?.ts ?? null;
    const statsSyncedAt = a.last_stats_synced_at ?? (latestStatDate ? `${latestStatDate}T23:59:59.999Z` : null);
    const dataAgeHours = statsSyncedAt
      ? Math.max(0, (Date.now() - new Date(statsSyncedAt).getTime()) / 3_600_000)
      : null;
    const roundedDataAgeHours = dataAgeHours == null ? null : Math.round(dataAgeHours * 10) / 10;
    const attributionCompatible = nmIds.length === 1
      && st.ordSum <= Math.max(1, Number(report?.orders_sum_month ?? 0)) * 1.2;
    const economics = calculateAdvertProfitGuardrail({
      price,
      cost: Number(report?.cost ?? 0) > 0 ? Number(report?.cost) : null,
      revenue: st.ordSum,
      spent: st.spent14,
      commissionPct: rate?.pct ?? commission.avgPct,
      acquiringPct: rate?.acqPct ?? commission.avgAcqPct,
      extraPct: (rate?.extraPct ?? commission.avgExtraPct) + commission.overheadPct,
      taxPct: 7,
      feesComplete: Boolean(rate || commission.avgPct > 0),
      stock: report ? Number(report.stock ?? 0) : null,
      dailyUnits: report ? Number(report.orders_month ?? 0) / 30 : null,
      attributionCompatible,
      dataAgeHours,
    });
    const latestChange = latestChangeByAdvert.get(Number(a.advert_id)) ?? null;
    const campaignDays = daysByAdv.get(a.advert_id) ?? [];
    const campaignDaysByDate = new Map(campaignDays.map((day) => [day.ts, day]));
    const comparison = latestChange
      ? compareAdvertBeforeAfter(
        campaignDays.map((day) => ({ date: day.ts, spent: day.spend, revenue: day.orders })),
        latestChange.created_at,
      )
      : null;
    const campaign = {
      id: a.advert_id,
      name: a.name ?? `Кампания ${a.advert_id}`,
      status: a.status,
      status_id: a.status,
      enabled: a.status === 9,
      nm,
      bid_type: "unified",
      budget: a.daily_budget ?? 0,
      spend_today: Math.round(st.today),
      spent_14: Math.round(st.spent14),
      ad_revenue_14: Math.round(st.ordSum),
      drr: economics.currentDrr,
      spent_7_closed: Math.round(closed.spent),
      ad_revenue_7_closed: Math.round(closed.attributedRevenue),
      drr_attributed_7_closed: closed.attributedDrr,
      drr_attributed_7_status: closed.status,
      metrics_period_7_closed: {
        date_from: metricsPeriod7Closed.dateFrom,
        date_to: metricsPeriod7Closed.dateTo,
      },
      photo: wbCardImageUrl(nm),
      category: "",
      hours: [],
      payment: "cpm",
      bid_cpm_rub: a.bid_cpm_rub ?? a.daily_budget ?? null,
      stats_synced_at: statsSyncedAt,
      stats_age_hours: roundedDataAgeHours,
      stats_stale: dataAgeHours == null || dataAgeHours > 3,
      cab: cabLabel,
      yesterday: buildAdvertWorkingDaySummary({
        date: yest,
        adDay: campaignDaysByDate.get(yest),
        funnel: funnelByNmDate.get(`${nm}:${yest}`),
        statsSyncedAt,
        statsAgeHours: roundedDataAgeHours,
        isComplete: true,
      }),
      today_open: buildAdvertWorkingDaySummary({
        date: today,
        adDay: campaignDaysByDate.get(today),
        funnel: funnelByNmDate.get(`${nm}:${today}`),
        statsSyncedAt,
        statsAgeHours: roundedDataAgeHours,
        isComplete: false,
      }),
      days: campaignDays,
      economics,
      attribution_compatible: attributionCompatible,
      last_change: latestChange ? {
        old_bid: latestChange.old_bid,
        new_bid: latestChange.new_bid,
        created_at: latestChange.created_at,
      } : null,
      comparison,
    };
    let g = artMap.get(nm);
    if (!g) {
      g = { nm, art: artByNm.get(nm) || String(nm), photo: wbCardImageUrl(nm), spend: 0, spent_sku_7_closed: Math.round(skuSpend7ClosedByNm.get(nm) ?? 0), campaigns: [] };
      artMap.set(nm, g);
    }
    g.spend += Math.round(st.today);
    g.campaigns.push(campaign);
  }

  const articles = [...artMap.values()].sort((a, b) => b.spend - a.spend);
  const spendTodayTotal = articles.reduce((s, a) => s + a.spend, 0);
  const activeCampaignCount = articles.reduce((count, article) => count + article.campaigns.filter((campaign) => campaign.status === 9).length, 0);

  return NextResponse.json({
    ok: true,
    cabinet: cabLabel,
    articles,
    // «Активных» = именно статус 9 (11 — на паузе, но остаётся в выборке для истории/аналитики)
    count: activeCampaignCount,
    cap_rub: 5000,
    balance,
    spend_today_total: spendTodayTotal,
    spend_yest_total: Math.round(spendYestTotal),
    today,
    yest,
    ...(wantTimings ? { timings_ms: timings } : {}),
  });
}
