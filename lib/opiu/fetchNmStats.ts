export interface NmStatRow {
  date: string;         // YYYY-MM-DD (rangeFrom недели — итог за период)
  ordersSumRub: number; // Заказали на сумму, руб (Воронка продаж v3)
}

export interface NmStatByNmRow {
  nmId: number;
  vendorCode: string;
  ordersCount: number;
  ordersSumRub: number;
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
  product?: {
    nmId?: number;
    vendorCode?: string;
  };
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
 * Общий цикл пагинации/retry по «Воронке продаж» v3.
 * Endpoint: POST /api/analytics/v3/sales-funnel/products
 */
async function fetchSalesFunnelProducts(
  dateFrom: string,
  dateTo: string,
  refresh: boolean,
): Promise<SalesFunnelProduct[]> {
  const token = analyticsToken();
  if (!token) return [];

  const url = "https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products";
  const all: SalesFunnelProduct[] = [];
  let page = 1;

  try {
    let retries429 = 0;
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
          ...(refresh ? { cache: "no-store" } : { cache: "force-cache" }),
        } as RequestInit);
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        if (res.status === 429 && retries429 < 3) {
          retries429++;
          console.warn(`[opiu] sales-funnel 429, retry ${retries429}/3 after 5s`);
          await new Promise<void>((r) => setTimeout(r, 5000));
          continue;
        }
        const errBody = await res.text().catch(() => "");
        console.warn("[opiu] sales-funnel HTTP", res.status, dateFrom, "→", dateTo, errBody.slice(0, 200));
        return all;
      }

      const data = (await res.json()) as SalesFunnelResponse;
      const products = data.data?.products ?? [];
      if (products.length === 0) break;

      all.push(...products);
      if (!data.data?.isNextPage) break;
      page++;
    }
    return all;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.warn("[opiu] sales-funnel timeout");
    } else {
      console.warn("[opiu] sales-funnel fetch error:", err);
    }
    return all;
  }
}

/**
 * Получает сумму заказов из WB Воронки продаж v3.
 * Суммирует orderSum по всем товарам за период — совпадает с NM-report ordersSumRub.
 * Возвращает один агрегированный NmStatRow с date = dateFrom.
 */
export async function fetchNmOrderStats(
  dateFrom: string,
  dateTo: string,
  refresh = false,
): Promise<NmStatRow[]> {
  const products = await fetchSalesFunnelProducts(dateFrom, dateTo, refresh);
  let totalOrderSum = 0;
  for (const p of products) {
    totalOrderSum += p.statistic?.selected?.orderSum ?? 0;
  }
  if (totalOrderSum === 0) return [];
  return [{ date: dateFrom, ordersSumRub: totalOrderSum }];
}

/**
 * То же самое, но с разбивкой по nmId — для таблицы «Маржа по артикулам».
 */
export async function fetchNmOrderStatsByNm(
  dateFrom: string,
  dateTo: string,
  refresh = false,
): Promise<Map<number, NmStatByNmRow>> {
  const products = await fetchSalesFunnelProducts(dateFrom, dateTo, refresh);
  const byNm = new Map<number, NmStatByNmRow>();
  for (const p of products) {
    const nmId = p.product?.nmId;
    if (!nmId) continue;
    const existing = byNm.get(nmId) ?? { nmId, vendorCode: p.product?.vendorCode ?? "", ordersCount: 0, ordersSumRub: 0 };
    existing.ordersCount += p.statistic?.selected?.orderCount ?? 0;
    existing.ordersSumRub += p.statistic?.selected?.orderSum ?? 0;
    byNm.set(nmId, existing);
  }
  return byNm;
}
