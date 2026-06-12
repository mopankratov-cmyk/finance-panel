import { wbFetch } from "./fetch";
import { SALES_LIMIT } from "./keys";
import type { WbReportRow } from "./types";

const REPORT_URL =
  "https://statistics-api.wildberries.ru/api/v5/supplier/reportDetailByPeriod";

function maxRrdId(rows: WbReportRow[]): number {
  let max = 0;
  for (const row of rows) {
    const id = Number(row.rrd_id);
    if (Number.isFinite(id) && id > max) max = id;
  }
  return max;
}

/** Полная загрузка финотчёта WB с пагинацией по rrd_id */
export async function fetchSalesReport(
  dateFrom: string,
  dateTo: string,
  refresh = false,
): Promise<WbReportRow[]> {
  const all: WbReportRow[] = [];
  let rrdid = 0;
  const limit = Number(SALES_LIMIT);

  for (let page = 0; page < 50; page++) {
    const url = new URL(REPORT_URL);
    url.searchParams.set("dateFrom", dateFrom);
    url.searchParams.set("dateTo", dateTo);
    url.searchParams.set("limit", SALES_LIMIT);
    url.searchParams.set("rrdid", String(rrdid));

    const res = await wbFetch<WbReportRow[]>(url.toString(), { method: "GET" }, { refresh });
    if (res.error) throw new Error(res.error);

    const chunk = res.data ?? [];
    if (chunk.length === 0) break;

    all.push(...chunk);

    if (chunk.length < limit) break;

    const nextRrdid = maxRrdId(chunk);
    if (!nextRrdid || nextRrdid === rrdid) break;
    rrdid = nextRrdid;
  }

  return all;
}
