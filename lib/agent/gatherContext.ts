import { buildRnpReport } from "@/lib/rnp/buildRnp";

export interface AgentSku {
  article: string;
  nmId: number;
  ordersMonth: number;
  ordersSumMonth: number;
  ordersToday: number;
  ordersYesterday: number;
  stock: number;
  inWay: number;
  /** дней до нуля при текущем темпе */
  daysLeft: number | null;
  turnoverDays: number | null;
  stockMoney: number | null;
  adSpend: number;
  drr: number | null;
}

export interface AgentContext {
  generatedAt: string;
  totals: {
    ordersSumMonth: number;
    adSpendMonth: number;
    stockMoney: number;
    skuCount: number;
  };
  skus: AgentSku[];
}

/**
 * Компактный срез данных WB для AI-агента: по каждому SKU темп заказов,
 * остатки/оборачиваемость, реклама и ДРР. Считается из rnp_report() —
 * без выгрузки тысяч строк в контекст модели.
 */
export async function gatherAgentContext(): Promise<AgentContext> {
  const rnp = await buildRnpReport();

  const skus: AgentSku[] = rnp.map((r) => {
    const avgDaily = r.periods.month.ordersCount / 30;
    return {
      article: r.article || String(r.nmId),
      nmId: r.nmId,
      ordersMonth: r.periods.month.ordersCount,
      ordersSumMonth: Math.round(r.periods.month.ordersSum),
      ordersToday: r.periods.today.ordersCount,
      ordersYesterday: r.periods.yesterday.ordersCount,
      stock: r.stock,
      inWay: r.inWayToClient,
      daysLeft: avgDaily > 0 ? Math.round(r.stock / avgDaily) : null,
      turnoverDays: r.turnoverDays,
      stockMoney: r.stockMoney != null ? Math.round(r.stockMoney) : null,
      adSpend: Math.round(r.adSpend),
      drr: r.drr != null ? Math.round(r.drr * 10) / 10 : null,
    };
  });

  const totals = {
    ordersSumMonth: skus.reduce((s, r) => s + r.ordersSumMonth, 0),
    adSpendMonth: skus.reduce((s, r) => s + r.adSpend, 0),
    stockMoney: skus.reduce((s, r) => s + (r.stockMoney ?? 0), 0),
    skuCount: skus.length,
  };

  return { generatedAt: new Date().toISOString(), totals, skus };
}
