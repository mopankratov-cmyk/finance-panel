import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadRnpReportRows } from "@/lib/rnp/rpcLoaders";
import { getWbCommissionMerged } from "@/lib/wb/commissions";

// Правиловый движок «что требует внимания» — пишет в agent_insights.
// Использует уже посчитанные данные: rnp_report (заказы/выручка/выкупы/остаток/себес/реклама) + фактическую комиссию.

export interface InsightDraft {
  module: string;
  severity: "high" | "medium" | "low";
  title: string;
  body: string;
  data: Record<string, unknown>;
}

interface RpcRow {
  nm_id: number;
  article: string;
  orders_month: number;
  orders_sum_month: number;
  buyouts_month: number;
  buyouts_sum_month: number;
  stock: number;
  in_way_to_client: number;
  cost: number | null;
  ad_spend_month: number;
}

const TAX = 7; // налоговый дефолт (как в юните)

export async function generateInsights(): Promise<InsightDraft[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const [rows, comm] = await Promise.all([
    loadRnpReportRows<RpcRow>(db, null, { label: "AI-инсайты WB: товары" }),
    getWbCommissionMerged(30),
  ]);
  const acqAvg = comm.avgAcqPct > 0 ? comm.avgAcqPct : 1.5;
  const commForNm = (nm: number) => comm.byNm.get(nm)?.pct ?? (comm.avgPct > 0 ? comm.avgPct : 25);

  const out: InsightDraft[] = [];
  const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");

  for (const r of rows) {
    const art = r.article || String(r.nm_id);
    const orders = Number(r.orders_month ?? 0);
    const rev = Number(r.orders_sum_month ?? 0);
    const cost = Number(r.cost ?? 0);
    const ad = Number(r.ad_spend_month ?? 0);
    const stock = Number(r.stock ?? 0);
    const inWay = Number(r.in_way_to_client ?? 0);
    const avgDaily = orders / 30;
    const price = orders > 0 ? rev / orders : 0;
    const drr = rev > 0 ? (ad / rev) * 100 : 0;
    const comm_ = commForNm(r.nm_id);
    const netUnit = price > 0 ? price - cost - price * (comm_ + acqAvg + TAX) / 100 - (orders > 0 ? ad / orders : 0) : 0;
    const netMargin = price > 0 ? (netUnit / price) * 100 : null;
    const gross = Number(r.buyouts_sum_month ?? 0) - cost * Number(r.buyouts_month ?? 0) - ad;
    const stockMoney = stock * cost;
    const gmroi = stockMoney > 0 ? (gross / stockMoney) * 100 : null;
    const daysLeft = stock > 0 && avgDaily > 0 ? Math.round(stock / avgDaily) : null;

    // 🔴 Убыточный (чистая маржа < 0) при наличии продаж
    if (orders >= 3 && netMargin != null && netMargin < 0) {
      out.push({
        module: "unit", severity: "high",
        title: `Убыток: ${art} (маржа ${netMargin.toFixed(1)}%)`,
        body: `Чистая маржа отрицательная при ${orders} заказах/мес. Цена ${fmt(price)}₽, себес ${fmt(cost)}₽, комиссия ${comm_.toFixed(0)}%, ДРР ${drr.toFixed(0)}%. Подними цену или сократи рекламу.`,
        data: { src: "rules", key: `loss:${r.nm_id}`, nm: r.nm_id },
      });
    }
    // 🔴 Скоро закончится при ходовом товаре
    else if (daysLeft != null && daysLeft <= 7 && avgDaily >= 0.5 && inWay <= avgDaily * 7) {
      const lost = Math.round(avgDaily * 14 * price);
      out.push({
        module: "stock", severity: "high",
        title: `Заканчивается: ${art} (~${daysLeft} дн.)`,
        body: `Остаток ${fmt(stock)} шт при ${avgDaily.toFixed(1)} зак./день. В пути ${fmt(inWay)}. Без поставки рискуешь потерять ~${fmt(lost)}₽ продаж за 2 недели.`,
        data: { src: "rules", key: `oos:${r.nm_id}`, nm: r.nm_id },
      });
    }
    // 🟡 Реклама ест прибыль
    else if (drr > 25 && netMargin != null && netMargin < 15 && orders >= 3) {
      out.push({
        module: "ads", severity: "medium",
        title: `Реклама ест маржу: ${art} (ДРР ${drr.toFixed(0)}%)`,
        body: `ДРР ${drr.toFixed(0)}% при чистой марже ${netMargin.toFixed(1)}%. Снизь ставку или останови РК — реклама не окупается.`,
        data: { src: "rules", key: `ads:${r.nm_id}`, nm: r.nm_id },
      });
    }
    // 🟡 Деньги мёртвым грузом
    else if (gmroi != null && gmroi < 20 && daysLeft != null && daysLeft > 90 && stockMoney > 10000) {
      out.push({
        module: "stock", severity: "medium",
        title: `Деньги в стоке: ${art} (GMROI ${gmroi.toFixed(0)}%)`,
        body: `${fmt(stockMoney)}₽ заморожено, оборачиваемость ~${daysLeft} дн. Низкая отдача — снизь цену/раскачай рекламу или не дозаказывай.`,
        data: { src: "rules", key: `slow:${r.nm_id}`, nm: r.nm_id },
      });
    }
  }

  // приоритет high → medium, и кап до 40
  out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
  return out.slice(0, 40);
}
