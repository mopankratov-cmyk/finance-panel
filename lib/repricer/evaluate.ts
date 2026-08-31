// Чистый движок правил репрайсера: метрики SKU + стратегии → решение old→new.
// Первая по приоритету стратегия, у которой совпали ВСЕ условия, выигрывает.
// margin_floor: при понижении цена не опускается ниже дающей целевую маржу (через priceForMargin из P0-2).

import { priceForMargin } from "@/lib/unit/priceSolver";

export type RepricerOp = "<" | ">" | "<=" | ">=" | "==";
export interface RepricerCondition { metric: string; op: RepricerOp; value: number }
export interface RepricerStrategy {
  id: number;
  name: string;
  action: "dec_pct" | "inc_pct";
  amount: number;        // % шага
  marginFloor: number;   // %
  conditions: RepricerCondition[];
  priority: number;
  enabled: boolean;
}

// Метрики SKU. gmroi/turnover/drr/margin собираются в роуте (см. комментарий о gmroi там).
export interface SkuMetrics {
  gmroi: number | null;
  stock: number;
  drr: number | null;
  turnover: number | null;   // дней оборачиваемости
  margin: number | null;     // маржа МД к выручке, %
  currentPrice: number | null;
  // для margin_floor:
  cogs: number;
  feeFraction: number;
  currentRevenue: number;
}

export interface UsedCondition { metric: string; op: RepricerOp; value: number; actual: number | null; match: boolean }
export interface RepricerDecision {
  strategyId: number | null;
  strategyName: string | null;
  oldPrice: number | null;
  newPrice: number | null;
  used: UsedCondition[];
  status: "proposed" | "skipped";
  note?: string;
}

function metricVal(m: SkuMetrics, key: string): number | null {
  switch (key) {
    case "gmroi": return m.gmroi;
    case "stock": return m.stock;
    case "drr": return m.drr;
    case "turnover": return m.turnover;
    case "margin": return m.margin;
    default: return null;
  }
}

function cmp(a: number | null, op: RepricerOp, b: number): boolean {
  if (a == null) return false;
  switch (op) {
    case "<": return a < b;
    case ">": return a > b;
    case "<=": return a <= b;
    case ">=": return a >= b;
    case "==": return a === b;
    default: return false;
  }
}

export function evaluateRepricer(m: SkuMetrics, strategies: RepricerStrategy[]): RepricerDecision {
  if (m.currentPrice == null || m.currentPrice <= 0) {
    return { strategyId: null, strategyName: null, oldPrice: m.currentPrice ?? null, newPrice: null, used: [], status: "skipped", note: "нет текущей цены" };
  }
  const ordered = [...strategies].filter((s) => s.enabled).sort((a, b) => a.priority - b.priority);
  for (const s of ordered) {
    const used: UsedCondition[] = s.conditions.map((c) => {
      const actual = metricVal(m, c.metric);
      return { metric: c.metric, op: c.op, value: c.value, actual, match: cmp(actual, c.op, c.value) };
    });
    if (used.length === 0 || !used.every((u) => u.match)) continue;

    const factor = s.action === "dec_pct" ? 1 - s.amount / 100 : 1 + s.amount / 100;
    let newPrice = Math.round(m.currentPrice * factor);
    let note: string | undefined;

    if (s.action === "dec_pct") {
      const floor = priceForMargin({ cogs: m.cogs, feeFraction: m.feeFraction, currentRevenue: m.currentRevenue, currentCatalogPrice: m.currentPrice, marginPct: s.marginFloor });
      // «Ограничить снижение» и «поднять цену» — разные вещи, а раньше это был
      // один и тот же код. Если пол маржи уже выше текущей цены, снижать
      // нечем: стратегия «снизить» предлагала ПОВЫШЕНИЕ, прямо противоположное
      // тому, что просил владелец.
      if (floor != null && floor >= m.currentPrice) {
        return {
          strategyId: s.id,
          strategyName: s.name,
          oldPrice: m.currentPrice,
          newPrice: null,
          used,
          status: "skipped",
          note: `маржа уже ниже пола ${s.marginFloor}% — снижать нечем`,
        };
      }
      if (floor != null && newPrice < floor) {
        newPrice = floor;
        note = `ограничено margin_floor ${s.marginFloor}%`;
      }
    }
    if (newPrice === m.currentPrice) {
      return { strategyId: s.id, strategyName: s.name, oldPrice: m.currentPrice, newPrice, used, status: "skipped", note: note ?? "цена без изменений" };
    }
    return { strategyId: s.id, strategyName: s.name, oldPrice: m.currentPrice, newPrice, used, status: "proposed", note };
  }
  return { strategyId: null, strategyName: null, oldPrice: m.currentPrice, newPrice: null, used: [], status: "skipped", note: "нет подходящей стратегии" };
}
