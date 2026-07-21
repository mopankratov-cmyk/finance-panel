import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  applyFunnelOrdersOverlay,
  buildScopedBaseFactsFromRows,
  loadAllPages,
  type ScopedOrderSourceRow,
  type ScopedProductSourceRow,
  type ScopedStockSourceRow,
} from "@/lib/rnp/buildTable";

type SupabaseAdmin = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

interface ProductCostRow {
  article: string;
  name: string | null;
  cost_rub?: number | null;
}

interface ScopedFunnelOrderSourceRow {
  nm_id: number;
  date: string;
  orders: number | null;
  orders_sum: number | null;
}

export interface ScopedAdvertReportRow {
  nm_id: number;
  article: string;
  orders_month: number;
  orders_sum_month: number;
  stock: number;
  in_way_to_client: number;
  cost: number | null;
}

export function advertMonthStart(now = new Date()): string {
  return new Date(now.getTime() - 29 * 86_400_000).toISOString().slice(0, 10);
}

export function buildScopedAdvertReportRowsFromFacts(input: {
  allowedNmIds: number[];
  orders: ScopedOrderSourceRow[];
  funnelOrders?: ScopedFunnelOrderSourceRow[];
  stocks: ScopedStockSourceRow[];
  products: ScopedProductSourceRow[];
  costs: ProductCostRow[];
}): ScopedAdvertReportRow[] {
  const baseFacts = buildScopedBaseFactsFromRows({
    allowedNmIds: input.allowedNmIds,
    orders: input.orders,
    sales: [],
    advertSpend: [],
    stocks: input.stocks,
    products: input.products,
    costs: input.costs,
  });
  const skuRows = applyFunnelOrdersOverlay(
    baseFacts.skuRows,
    (input.funnelOrders ?? []).map((row) => ({
      ...row,
      open_card: null,
      add_to_cart: null,
    })),
  );
  const monthByNm = new Map<number, { orders: number; sum: number }>();
  for (const row of skuRows) {
    const nmId = Number(row.nm_id);
    const current = monthByNm.get(nmId) ?? { orders: 0, sum: 0 };
    current.orders += Number(row.orders_count ?? 0);
    current.sum += Number(row.orders_sum ?? 0);
    monthByNm.set(nmId, current);
  }

  return baseFacts.totals.map((total) => {
    const month = monthByNm.get(Number(total.nm_id)) ?? { orders: 0, sum: 0 };
    return {
      nm_id: Number(total.nm_id),
      article: String(total.article ?? ""),
      orders_month: month.orders,
      orders_sum_month: month.sum,
      stock: Number(total.stock ?? 0),
      in_way_to_client: 0,
      cost: total.cost == null ? null : Number(total.cost),
    };
  });
}

/**
 * Fast path for scoped brand cabinets (for example Optima → only NORVIA/RIOBOX).
 *
 * The adverts screen only needs SKU economics for the allowlisted nm_id set.
 * Calling the full-cabinet rnp_report first and filtering afterwards makes the
 * user request pay for unrelated seller data and can exceed the 45s UI timeout.
 */
export async function loadScopedAdvertReportRows(
  db: SupabaseAdmin,
  cabinetId: string,
  allowedNmIds: number[],
): Promise<ScopedAdvertReportRow[]> {
  if (!allowedNmIds.length) return [];
  const monthStart = advertMonthStart();
  const monthStartTs = `${monthStart}T00:00:00.000Z`;

  const [orders, funnelOrders, stocks, products] = await Promise.all([
    loadAllPages<ScopedOrderSourceRow>((from, to) => db
      .from("wb_orders")
      .select("nm_id, supplier_article, date, total_price, discount_percent, is_cancel")
      .eq("cabinet_id", cabinetId)
      .gte("date", monthStartTs)
      .in("nm_id", allowedNmIds)
      .order("date", { ascending: true })
      .order("nm_id", { ascending: true })
      .range(from, to)),
    loadAllPages<ScopedFunnelOrderSourceRow>((from, to) => db
      .from("wb_funnel_daily")
      .select("nm_id, date, orders, orders_sum")
      .eq("cabinet_id", cabinetId)
      .gte("date", monthStart)
      .in("nm_id", allowedNmIds)
      .order("date", { ascending: true })
      .order("nm_id", { ascending: true })
      .range(from, to)),
    loadAllPages<ScopedStockSourceRow>((from, to) => db
      .from("wb_stocks")
      .select("nm_id, quantity")
      .eq("cabinet_id", cabinetId)
      .in("nm_id", allowedNmIds)
      .order("nm_id", { ascending: true })
      .range(from, to)),
    loadAllPages<ScopedProductSourceRow>((from, to) => db
      .from("wb_cabinet_product_scope")
      .select("nm_id, article")
      .eq("cabinet_id", cabinetId)
      .in("nm_id", allowedNmIds)
      .order("nm_id", { ascending: true })
      .range(from, to)),
  ]);

  const articleSet = new Set<string>();
  for (const product of products) if (product.article) articleSet.add(product.article);
  for (const order of orders) if (order.supplier_article) articleSet.add(order.supplier_article);
  const articles = [...articleSet];
  const costs = articles.length
    ? await loadAllPages<ProductCostRow>((from, to) => db
      .from("product_costs")
      .select("article, name, cost_rub")
      .in("article", articles)
      .order("article", { ascending: true })
      .range(from, to))
    : [];

  return buildScopedAdvertReportRowsFromFacts({ allowedNmIds, orders, funnelOrders, stocks, products, costs });
}
