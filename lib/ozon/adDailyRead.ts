import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Чтение истории рекламы по дням — постранично.
 *
 * Supabase молча отдаёт максимум 1000 строк на запрос. История «кабинет ×
 * товар × день» перешагивает этот потолок быстро: сто товаров за квартал —
 * это девять тысяч строк. Обрезанная выборка выглядит как честный ответ, но
 * занижает расход, и заметить это по цифрам невозможно.
 */
export interface OzonAdDailyRow {
  client_id: string;
  sku: string;
  date: string;
  spent: number | string | null;
  orders_money: number | string | null;
  updated_at?: string | null;
}

const PAGE = 1000;

export async function readOzonAdDaily(
  db: SupabaseClient,
  clientIds: string[],
  from: string,
  to: string,
  columns = "client_id, sku, spent, orders_money, updated_at, date",
): Promise<{ rows: OzonAdDailyRow[]; truncated: boolean }> {
  const rows: OzonAdDailyRow[] = [];
  if (!clientIds.length) return { rows, truncated: false };
  // Потолок страниц — защита от бесконечного цикла, а не ограничение данных:
  // 50 страниц это 50 000 строк, больше квартала по любому кабинету.
  for (let page = 0; page < 50; page++) {
    const { data, error } = await db
      .from("ozon_ad_daily")
      .select(columns)
      .in("client_id", clientIds)
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: true })
      .order("sku", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as unknown as OzonAdDailyRow[];
    rows.push(...batch);
    if (batch.length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}
