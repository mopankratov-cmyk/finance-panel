import { SALES_LIMIT } from "./keys";
import { fetchWbReportPages } from "./reportPagination";
import type { WbReportRow } from "./types";

/** Полная загрузка финотчёта WB с пагинацией по rrd_id */
export async function fetchSalesReport(
  dateFrom: string,
  dateTo: string,
  refresh = false,
  token?: string,
): Promise<WbReportRow[]> {
  const resolvedToken = token || process.env.WB_STATS_TOKEN || process.env.WB_TOKEN_STATISTICS;
  if (!resolvedToken) throw new Error("WB_TOKEN_STATISTICS не настроен. Добавьте токен в .env.local");
  const result = await fetchWbReportPages<WbReportRow>({
    token: resolvedToken,
    dateFrom,
    dateTo,
    limit: Number(SALES_LIMIT),
    cacheKey: refresh ? `refresh-${Date.now()}` : "opiu",
  });
  return result.rows;
}
