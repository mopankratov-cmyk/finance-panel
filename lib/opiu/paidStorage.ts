import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import type { MonthWeek } from "./weeks";
import type { OpiuBrand } from "./constants";

interface PaidStorageRow {
  date: string;
  vendor_code: string | null;
  warehouse_price: number | null;
}

function matchesVendorPrefix(vendorCode: string | null | undefined, prefixes: string[] | undefined): boolean {
  if (!prefixes || prefixes.length === 0) return true;
  const normalized = String(vendorCode ?? "").trim().toUpperCase();
  if (!normalized) return false;
  return prefixes.some((p) => normalized.startsWith(p.toUpperCase()));
}

/**
 * "Хранение" по данным WB "Платное хранение" — в отличие от
 * wb_report_rows.storage_fee, обезличенного на весь кабинет (nm_id: 0),
 * этот отчёт даёт разбивку по товару.
 *
 * Суб-бренды на общем кабинете (Norvia/Heaton — Retail Family) сопоставляем
 * по префиксу vendor_code — это же поле WB сам присылает в отчёте построчно,
 * дополнительных join'ов не нужно. Раньше пробовали через whitelist nm_id
 * (собранный из заказов/продаж за неделю, как эталонная таблица владельца),
 * но это давало систематическую недостачу: артикул без единой продажи за
 * неделю (но лежащий на складе и получающий начисление хранения) не попадал
 * в whitelist и терялся — сверено на реальном расхождении (Norvia 24-30.08:
 * whitelist давал 7776.80 ₽ вместо верных 9395.80 ₽, ровно на сумму 6
 * "непроданных" в ту неделю артикулов). Прямой фильтр по vendor_code такой
 * потери не имеет и сходится с официальным отчётом WB и ручной сверкой
 * владельца до рубля.
 *
 * Возвращает null, если для кабинета в этом диапазоне дат вообще нет
 * синканных строк — вызывающий код должен в этом случае откатиться на
 * storage_fee (см. warehousePackaging в aggregateWeek), а не молча
 * показать 0 вместо ещё не досинканных данных.
 */
export async function fetchPaidStorageByWeek(
  brand: OpiuBrand,
  weeks: MonthWeek[],
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
      .select("date, vendor_code, warehouse_price")
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
    if (brand.articlePrefixes?.length && !matchesVendorPrefix(row.vendor_code, brand.articlePrefixes)) continue;
    const week = weeks.find((w) => row.date >= w.rangeFrom && row.date <= w.rangeTo);
    if (!week) continue;
    map[week.weekStart] = (map[week.weekStart] ?? 0) + Number(row.warehouse_price ?? 0);
  }

  return map;
}
