import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import type { MonthWeek } from "./weeks";
import type { OpiuBrand } from "./constants";

// Дублирует matchesArticlePrefix (loadMonth.ts) без импорта оттуда — loadMonth
// сам импортирует этот модуль, циклическая зависимость иначе неизбежна.
function matchesVendorPrefix(vendorCode: string | null | undefined, prefixes: string[] | undefined): boolean {
  if (!prefixes || prefixes.length === 0) return true;
  const normalized = String(vendorCode ?? "").trim().toUpperCase();
  if (!normalized) return false;
  return prefixes.some((p) => normalized.startsWith(p.toUpperCase()));
}

interface PaidStorageRow {
  date: string;
  vendor_code: string | null;
  warehouse_price: number | null;
}

/**
 * "Хранение" по данным WB "Платное хранение" (per nmId/vendorCode) —
 * в отличие от wb_report_rows.storage_fee, обезличенного на весь кабинет
 * (nm_id: 0), этот отчёт можно честно разложить по суб-бренду через
 * vendorCode-префикс (Norvia/Heaton на общем кабинете Retail Family).
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
