// Поставки (incomes) — statistics-api.wildberries.ru/api/v1/supplier/incomes.
// Нужен только для распределения столбца «Транзит»: удержание финотчёта за транзитную
// доставку поставки привязано к конкретному incomeId (номеру поставки), а состав этой
// поставки (nmId + quantity по каждой позиции) берём отсюда.

import { wbFetch } from "@/lib/wb/fetch";

export interface IncomeRow {
  incomeId: string;
  nmId: number;
  barcode: string;
  quantity: number;
  dateClose: string;
}

interface IncomeApiRow {
  incomeId?: number | string;
  nmId?: number;
  barcode?: string;
  quantity?: number;
  dateClose?: string;
  [key: string]: unknown;
}

const INCOMES_URL = "https://statistics-api.wildberries.ru/api/v1/supplier/incomes";

/** dateFrom — начало окна поиска поставок (обычно за несколько месяцев до периода отчёта) */
export async function fetchIncomes(dateFrom: string, refresh = false): Promise<IncomeRow[]> {
  const url = new URL(INCOMES_URL);
  url.searchParams.set("dateFrom", dateFrom);

  const res = await wbFetch<IncomeApiRow[]>(url.toString(), { method: "GET" }, { refresh });
  if (res.error) {
    console.warn("[opiu] supplier/incomes error:", res.error);
    return [];
  }
  return (res.data ?? [])
    .filter((r) => r.incomeId != null && r.nmId)
    .map((r) => ({
      incomeId: String(r.incomeId),
      nmId: Number(r.nmId),
      barcode: String(r.barcode ?? ""),
      quantity: Number(r.quantity ?? 0) || 0,
      dateClose: String(r.dateClose ?? "").slice(0, 10),
    }));
}
