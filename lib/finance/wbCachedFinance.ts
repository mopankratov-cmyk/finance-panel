import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";

interface SaleRow {
  cabinet_id: string | null;
  nm_id: number;
  date: string;
  sale_id: string;
  for_pay: number | null;
  finished_price: number | null;
  price_with_disc: number | null;
}

interface RateRow {
  cabinet_id: string;
  nm_id: number;
  pct: number;
  acq_pct: number;
  extra_pct: number;
  rev: number;
  synced_at: string;
}

interface OverheadRow {
  cabinet_id: string;
  overhead_pct: number;
  rev: number;
  synced_at: string;
}

interface AdvertRow {
  cabinet_id: string | null;
  spent: number;
}

interface ProductRow {
  nm_id: number;
  article: string | null;
}

interface CostRow {
  article: string;
  cost_rub: number;
}

export interface WbCachedFinance {
  revenueBeforeSpp: number;
  revenue: number;
  payout: number;
  returns: number;
  commission: number;
  acquiring: number;
  marketplaceOther: number;
  ad: number;
  cogs: number;
  tax: number;
  profit: number;
  margin: number;
  units: number;
  rowsCount: number;
  source: "sync_cache";
  warnings: string[];
  updatedAt: string | null;
}

const num = (value: unknown) => Number(value ?? 0) || 0;
const round = (value: number) => Math.round(value);

function saleAmount(row: SaleRow) {
  return Math.abs(num(row.price_with_disc) || num(row.finished_price) || num(row.for_pay));
}

function isReturn(row: SaleRow) {
  return String(row.sale_id || "").toUpperCase().startsWith("R");
}

function rateKey(cabinetId: string | null, nmId: number) {
  return `${cabinetId ?? "legacy"}:${nmId}`;
}

export async function loadWbCachedFinance(options: {
  dateFrom: string;
  dateTo: string;
  cabinetId: string | null;
  taxPct: number;
}): Promise<WbCachedFinance> {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase не настроен");
  const { dateFrom, dateTo, cabinetId, taxPct } = options;

  const salesPromise = loadAllSupabasePages<SaleRow>((from, to) => {
    let query = db
      .from("wb_sales")
      .select("cabinet_id, nm_id, date, sale_id, for_pay, finished_price, price_with_disc")
      .gte("date", dateFrom)
      .lte("date", `${dateTo}T23:59:59.999Z`)
      .order("date", { ascending: true })
      .order("sale_id", { ascending: true })
      .range(from, to);
    if (cabinetId) query = query.eq("cabinet_id", cabinetId);
    return query;
  }, { maxPages: 500, label: "Финансы WB: продажи" });

  const ratesPromise = loadAllSupabasePages<RateRow>((from, to) => {
    let query = db
      .from("wb_nm_commissions")
      .select("cabinet_id, nm_id, pct, acq_pct, extra_pct, rev, synced_at")
      .order("cabinet_id", { ascending: true })
      .order("nm_id", { ascending: true })
      .range(from, to);
    if (cabinetId) query = query.eq("cabinet_id", cabinetId);
    return query;
  }, { maxPages: 100, label: "Финансы WB: комиссии" });

  const overheadPromise = (async () => {
    let query = db
      .from("wb_cabinet_commission_overhead")
      .select("cabinet_id, overhead_pct, rev, synced_at");
    if (cabinetId) query = query.eq("cabinet_id", cabinetId);
    const result = await query;
    if (result.error) throw new Error(`Финансы WB: общие удержания: ${result.error.message}`);
    return (result.data ?? []) as OverheadRow[];
  })();

  const advertsPromise = loadAllSupabasePages<AdvertRow>((from, to) => {
    let query = db
      .from("wb_advert_nm_daily")
      .select("cabinet_id, spent")
      .gte("date", dateFrom)
      .lte("date", dateTo)
      .order("date", { ascending: true })
      .range(from, to);
    if (cabinetId) query = query.eq("cabinet_id", cabinetId);
    return query;
  }, { maxPages: 300, label: "Финансы WB: реклама" });

  const costsPromise = (async () => {
    const result = await db.from("product_costs").select("article, cost_rub");
    if (result.error) throw new Error(`Финансы WB: себестоимость: ${result.error.message}`);
    return (result.data ?? []) as CostRow[];
  })();

  const [sales, rates, overheadRows, adverts, costs] = await Promise.all([
    salesPromise,
    ratesPromise,
    overheadPromise,
    advertsPromise,
    costsPromise,
  ]);

  const products = await loadAllSupabasePages<ProductRow>(async (from, to) => {
    const result = await db
      .rpc("rnp_report", { p_cabinet: cabinetId })
      .select("nm_id, article")
      .order("nm_id", { ascending: true })
      .range(from, to);
    return { data: (result.data ?? []) as unknown as ProductRow[], error: result.error };
  }, { maxPages: 100, label: "Финансы WB: товары" });

  const costByArticle = new Map(costs.map((row) => [String(row.article || "").trim().toUpperCase(), num(row.cost_rub)]));
  const articleByNm = new Map<number, string>();
  for (const row of products) {
    const article = String(row.article || "").trim().toUpperCase();
    if (article) articleByNm.set(Number(row.nm_id), article);
  }

  const ratesByNm = new Map<string, RateRow>();
  const weightedByCabinet = new Map<string, { commission: number; acquiring: number; extra: number; rev: number }>();
  for (const row of rates) {
    ratesByNm.set(rateKey(row.cabinet_id, Number(row.nm_id)), row);
    const current = weightedByCabinet.get(row.cabinet_id) ?? { commission: 0, acquiring: 0, extra: 0, rev: 0 };
    const rev = Math.max(0, num(row.rev));
    current.commission += num(row.pct) * rev;
    current.acquiring += num(row.acq_pct) * rev;
    current.extra += num(row.extra_pct) * rev;
    current.rev += rev;
    weightedByCabinet.set(row.cabinet_id, current);
  }
  const overheadByCabinet = new Map(overheadRows.map((row) => [row.cabinet_id, num(row.overhead_pct)]));

  let revenueBeforeSpp = 0;
  let payout = 0;
  let returns = 0;
  let commission = 0;
  let acquiring = 0;
  let marketplaceOther = 0;
  let cogs = 0;
  let units = 0;
  const missingRates = new Set<string>();
  const missingCosts = new Set<number>();

  for (const row of sales) {
    const amount = saleAmount(row);
    const pay = Math.abs(num(row.for_pay));
    if (isReturn(row)) {
      returns += amount;
      payout -= pay;
      continue;
    }
    revenueBeforeSpp += amount;
    payout += pay;
    units += 1;
    const cabinet = row.cabinet_id ?? "legacy";
    const direct = ratesByNm.get(rateKey(row.cabinet_id, Number(row.nm_id)));
    const weighted = weightedByCabinet.get(cabinet);
    const fallback = weighted && weighted.rev > 0
      ? {
          pct: weighted.commission / weighted.rev,
          acq_pct: weighted.acquiring / weighted.rev,
          extra_pct: weighted.extra / weighted.rev,
        }
      : null;
    const pct = direct ? num(direct.pct) : num(fallback?.pct);
    const acqPct = direct ? num(direct.acq_pct) : num(fallback?.acq_pct);
    const extraPct = direct ? num(direct.extra_pct) : num(fallback?.extra_pct);
    if (!direct && !fallback) missingRates.add(cabinet);
    commission += amount * pct / 100;
    acquiring += amount * acqPct / 100;
    marketplaceOther += amount * (extraPct + num(overheadByCabinet.get(cabinet))) / 100;

    const article = articleByNm.get(Number(row.nm_id));
    const unitCost = article ? costByArticle.get(article) : undefined;
    if (unitCost == null) missingCosts.add(Number(row.nm_id));
    else cogs += unitCost;
  }

  const ad = adverts.reduce((sum, row) => sum + Math.abs(num(row.spent)), 0);
  const revenue = revenueBeforeSpp;
  const tax = revenue * taxPct / 100;
  const profit = revenue - commission - acquiring - marketplaceOther - ad - cogs - tax;
  const timestamps = [...rates.map((row) => row.synced_at), ...overheadRows.map((row) => row.synced_at)]
    .filter(Boolean)
    .sort();
  const warnings: string[] = [];
  if (missingRates.size) warnings.push(`Нет свежего финотчёта комиссии для ${missingRates.size} кабинет(ов)`);
  if (missingCosts.size) warnings.push(`Не задана себестоимость для ${missingCosts.size} SKU`);

  return {
    revenueBeforeSpp: round(revenueBeforeSpp),
    revenue: round(revenue),
    payout: round(payout),
    returns: round(returns),
    commission: round(commission),
    acquiring: round(acquiring),
    marketplaceOther: round(marketplaceOther),
    ad: round(ad),
    cogs: round(cogs),
    tax: round(tax),
    profit: round(profit),
    margin: revenue > 0 ? Math.round((profit / revenue) * 1_000) / 10 : 0,
    units,
    rowsCount: sales.length,
    source: "sync_cache",
    warnings,
    updatedAt: timestamps.at(-1) ?? null,
  };
}
