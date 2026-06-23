// Сборка метрик SKU и прогон репрайсера. Используется POST /api/repricer/run и крон.
// gmroi (proxy): annualGrossProfit / inventoryCost × 100, где
//   annualGrossProfit = (маржа МД % /100) × заказы ₽ за месяц × 12,
//   inventoryCost     = остаток × себестоимость.
// Это ориентир (как у Юры gmroi%); калибровать на наших данных.

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildRnpReport } from "@/lib/rnp/buildRnp";
import { getWbCommissionMerged } from "@/lib/wb/commissions";
import { getActiveWbCabinets } from "@/lib/wb/cabinetTokens";
import { fetchWbCatalogPrices, WbPriceScopeError } from "@/lib/wb/prices";
import { solvePrices } from "@/lib/unit/priceSolver";
import { evaluateRepricer, type RepricerStrategy, type SkuMetrics, type RepricerDecision } from "./evaluate";

interface StrategyRow {
  id: number; name: string; action: string; amount: number; margin_floor: number;
  conditions: unknown; priority: number; enabled: boolean;
}

export async function loadStrategies(): Promise<RepricerStrategy[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("repricer_strategies").select("*").order("priority");
  return ((data ?? []) as StrategyRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    action: r.action === "inc_pct" ? "inc_pct" : "dec_pct",
    amount: Number(r.amount),
    marginFloor: Number(r.margin_floor),
    conditions: Array.isArray(r.conditions) ? (r.conditions as RepricerStrategy["conditions"]) : [],
    priority: Number(r.priority ?? 100),
    enabled: !!r.enabled,
  }));
}

export interface RepricerRunRow {
  nm: number;
  article: string;
  cabinet: string | null;
  metrics: { gmroi: number | null; margin: number | null; drr: number | null; stock: number; turnover: number | null; currentRevenue: number };
  decision: RepricerDecision;
}

// Прогон по одному кабинету (или всем, если cabinet=null). Возвращает строки решений (без записи).
export async function runRepricer(cabinet: string | null, strategies: RepricerStrategy[]): Promise<RepricerRunRow[]> {
  const rnp = await buildRnpReport(cabinet);
  const comm = await getWbCommissionMerged(30);

  const wantNms = new Set<number>(rnp.map((r) => r.nmId));
  const priceByNm = new Map<number, number>();
  try {
    const cabs = await getActiveWbCabinets();
    for (const c of cabs) {
      try {
        const prices = await fetchWbCatalogPrices(c.token, wantNms);
        for (const [nm, p] of prices) if (!priceByNm.has(nm) && p.price > 0) priceByNm.set(nm, p.price);
      } catch (e) {
        if (!(e instanceof WbPriceScopeError)) throw e;
      }
    }
  } catch {
    /* каталог опционален */
  }

  return rnp.map((r) => {
    const rates = comm.byNm.get(r.nmId);
    const feeFraction = ((rates?.pct ?? comm.avgPct) + (rates?.acqPct ?? comm.avgAcqPct) + (rates?.extraPct ?? comm.avgExtraPct) + comm.overheadPct) / 100;
    const month = r.periods.month;
    const currentRevenue = month.ordersCount > 0 ? month.ordersSum / month.ordersCount : 0;
    const marginPct = solvePrices({ cogs: r.cost ?? 0, feeFraction, currentRevenue, margins: [] }).currentMarginPct;

    const inventoryCost = r.stockMoney; // остаток × себестоимость
    // Калибровка по реальному прогону (120 SKU): медиана gmroi ~149, но крошечный остаток
    // даёт выбросы до сотен тысяч %. Клампим в [-999, 9999] — пороги (gmroi≷200) не меняются,
    // но число читаемо (как ~999%-потолок у Юры).
    const gmroiRaw =
      marginPct != null && inventoryCost != null && inventoryCost > 0
        ? ((marginPct / 100) * month.ordersSum * 12) / inventoryCost * 100
        : null;
    const gmroi = gmroiRaw == null ? null : Math.round(Math.max(-999, Math.min(9999, gmroiRaw)));

    const currentPrice = priceByNm.get(r.nmId) ?? null;
    const m: SkuMetrics = {
      gmroi,
      stock: r.stock,
      drr: r.drr,
      turnover: r.turnoverDays,
      margin: marginPct,
      currentPrice,
      cogs: r.cost ?? 0,
      feeFraction,
      currentRevenue,
    };
    const decision = evaluateRepricer(m, strategies);
    return {
      nm: r.nmId,
      article: r.article,
      cabinet,
      metrics: { gmroi, margin: marginPct, drr: r.drr, stock: r.stock, turnover: r.turnoverDays, currentRevenue: Math.round(currentRevenue) },
      decision,
    };
  });
}

// Сохранение решений за дату (идемпотентно: удаляем прошлые за (run_date, cabinet), пишем заново).
export async function persistDecisions(runDate: string, cabinet: string | null, rows: RepricerRunRow[]): Promise<number> {
  const db = getSupabaseAdmin();
  if (!db) return 0;
  await db.from("repricer_decisions").delete().eq("run_date", runDate).eq("cabinet", cabinet ?? "");
  const toInsert = rows.map((r) => ({
    run_date: runDate,
    cabinet: r.cabinet ?? "",
    nm_id: r.nm,
    article: r.article,
    strategy_id: r.decision.strategyId,
    strategy_name: r.decision.strategyName,
    old_price: r.decision.oldPrice,
    new_price: r.decision.newPrice,
    metrics: r.metrics,
    used: r.decision.used,
    status: r.decision.status,
    note: r.decision.note ?? null,
  }));
  if (toInsert.length) await db.from("repricer_decisions").insert(toInsert);
  return toInsert.filter((r) => r.status === "proposed").length;
}
