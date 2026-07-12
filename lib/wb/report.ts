// Финотчёт-детализация WB (reportDetailByPeriod) по одному токену.
// cacheKey разделяет кэш Next между кабинетами (одинаковый URL + разный токен
// иначе мог бы отдать чужие данные из кэша). WB игнорирует лишний query-параметр.

import { allowsProduct, type WbProductScope } from "@/lib/wb/productScope";

const BASE = "https://statistics-api.wildberries.ru/api/v5/supplier/reportDetailByPeriod";

export async function fetchWbReport<T = Record<string, unknown>>(
  token: string,
  from: string,
  to: string,
  cacheKey: string,
): Promise<T[]> {
  const url = `${BASE}?dateFrom=${from}&dateTo=${to}&limit=100000&rrdid=0&_c=${encodeURIComponent(cacheKey)}`;
  const res = await fetch(url, { headers: { Authorization: token }, next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`WB ${res.status}: ${(await res.text()).slice(0, 150)}`);
  const data = await res.json();
  return Array.isArray(data) ? (data as T[]) : [];
}

// Собрать строки финотчёта по набору токенов (кабинетов) и склеить.
export async function fetchWbReportRows<T = Record<string, unknown>>(
  tokens: Array<{ key: string; token: string; scope: WbProductScope }>,
  from: string,
  to: string,
): Promise<{ rows: T[]; errors: string[] }> {
  const errors: string[] = [];
  const lists = await Promise.all(
    tokens.map(async (t) => {
      try {
        const rows = await fetchWbReport<T>(t.token, from, to, t.key);
        return rows.filter((row) => {
          const raw = row as Record<string, unknown>;
          return allowsProduct(t.scope, raw.nm_id, raw.brand_name ?? raw.brand);
        });
      } catch (e) {
        errors.push(`${t.key}: ${String(e).slice(0, 100)}`);
        return [] as T[];
      }
    }),
  );
  return { rows: lists.flat(), errors };
}
