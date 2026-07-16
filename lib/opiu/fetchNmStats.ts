export interface NmStatRow {
  date: string;         // YYYY-MM-DD (rangeFrom недели — итог за период)
  ordersSumRub: number; // Заказали на сумму, руб (Воронка продаж v3)
}

function analyticsToken(): string {
  return (
    process.env.WB_TOKEN_ANALYTICS ??
    process.env.WB_STATS_TOKEN ??
    process.env.WB_TOKEN_STATISTICS ??
    ""
  );
}

interface SalesFunnelProduct {
  statistic?: {
    selected?: {
      orderSum?: number;
      orderCount?: number;
    };
  };
}

interface SalesFunnelResponse {
  data?: {
    products?: SalesFunnelProduct[];
    isNextPage?: boolean;
  };
}

/**
 * Получает сумму заказов из WB Воронки продаж v3.
 * Endpoint: POST /api/analytics/v3/sales-funnel/products
 * Суммирует orderSum по всем товарам за период — совпадает с NM-report ordersSumRub.
 * Возвращает один агрегированный NmStatRow с date = dateFrom.
 */
export async function fetchNmOrderStats(
  dateFrom: string,
  dateTo: string,
  refresh = false,
): Promise<NmStatRow[]> {
  const token = analyticsToken();
  if (!token) return [];

  const url = "https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products";
  let totalOrderSum = 0;
  let page = 1;

  try {
    while (page <= 100) {
      const body = JSON.stringify({
        selectedPeriod: { start: dateFrom, end: dateTo },
        timezone: "Europe/Moscow",
        page,
      });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { Authorization: token, "Content-Type": "application/json" },
          body,
          signal: controller.signal,
          cache: refresh ? "no-store" : undefined,
        } as RequestInit);
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        if (res.status !== 401 && res.status !== 403) {
          console.warn("[opiu] sales-funnel HTTP", res.status);
        }
        return [];
      }

      const data = (await res.json()) as SalesFunnelResponse;
      const products = data.data?.products ?? [];
      if (products.length === 0) break;

      for (const p of products) {
        totalOrderSum += p.statistic?.selected?.orderSum ?? 0;
      }
      if (!data.data?.isNextPage) break;
      page++;
    }

    if (totalOrderSum === 0) return [];
    return [{ date: dateFrom, ordersSumRub: totalOrderSum }];
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.warn("[opiu] sales-funnel timeout");
    } else {
      console.warn("[opiu] sales-funnel fetch error:", err);
    }
    return [];
  }
}
