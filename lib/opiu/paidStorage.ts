import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import type { MonthWeek } from "./weeks";
import type { OpiuBrand } from "./constants";

interface PaidStorageRow {
  date: string;
  nm_id: number | null;
  warehouse_price: number | null;
}

/**
 * "Хранение" по данным WB "Платное хранение" (per nmId) — в отличие от
 * wb_report_rows.storage_fee, обезличенного на весь кабинет (nm_id: 0),
 * этот отчёт даёт разбивку по товару.
 *
 * Суб-бренды на общем кабинете (Norvia/Heaton — Retail Family) сопоставляем
 * ПО NM_ID, а не по префиксу артикула поставщика — так же, как эталонная
 * таблица владельца (её формула хранения — SUMIFS по nmId). nmIdWhitelist —
 * набор nm_id этого суб-бренда за период (см. brandNmIdWhitelist в
 * loadMonth.ts, тот же whitelist уже используется для рекламных расходов).
 * undefined = бренд без суб-брендов на кабинете, фильтр не нужен.
 *
 * Возвращает null, если для кабинета в этом диапазоне дат вообще нет
 * синканных строк — вызывающий код должен в этом случае откатиться на
 * storage_fee (см. warehousePackaging в aggregateWeek), а не молча
 * показать 0 вместо ещё не досинканных данных.
 */
export async function fetchPaidStorageByWeek(
  brand: OpiuBrand,
  weeks: MonthWeek[],
  nmIdWhitelist?: Set<number>,
): Promise<Record<string, number> | null> {
  if (!weeks.length) return {};
  const client = getSupabaseAdmin();
  if (!client) return null;

  const dateFrom = weeks[0]!.rangeFrom;
  const dateTo = weeks[weeks.length - 1]!.rangeTo;

  let rows: PaidStorageRow[];
  try {
    rows = await loadAllSupabasePages<PaidStorageRow>((from, to) => client
      .from("wb_paid_storage_rows")
      .select("date, nm_id, warehouse_price")
      .eq("cabinet_id", brand.cabinetId)
      .gte("date", dateFrom)
      .lte("date", dateTo)
      .range(from, to), { maxPages: 1_000, label: "ОПиУ: Платное хранение" });
  } catch (e) {
    // Таблица появляется отдельной миграцией (owner-approved) — до её
    // применения на проде это ожидаемо, откатываемся на storage_fee.
    console.error("[opiu] paid storage read:", e instanceof Error ? e.message : e);
    return null;
  }

  if (!rows.length) return null;

  const map: Record<string, number> = {};
  for (const w of weeks) map[w.weekStart] = 0;

  for (const row of rows) {
    if (nmIdWhitelist && (row.nm_id == null || !nmIdWhitelist.has(row.nm_id))) continue;
    const week = weeks.find((w) => row.date >= w.rangeFrom && row.date <= w.rangeTo);
    if (!week) continue;
    map[week.weekStart] = (map[week.weekStart] ?? 0) + Number(row.warehouse_price ?? 0);
  }

  return map;
}
