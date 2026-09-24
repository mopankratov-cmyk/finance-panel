import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import type { MonthWeek } from "./weeks";
import type { OpiuBrand } from "./constants";

interface PaidStorageRow {
  id: string;
  date: string;
  vendor_code: string | null;
  warehouse_price: number | null;
}

interface PaidStorageDailyRow {
  source_ready: boolean;
  storage_date: string | null;
  warehouse_price: number | null;
}

function matchesVendorPrefix(vendorCode: string | null | undefined, prefixes: string[] | undefined): boolean {
  if (!prefixes || prefixes.length === 0) return true;
  const normalized = String(vendorCode ?? "").trim().toUpperCase();
  if (!normalized) return false;
  return prefixes.some((p) => normalized.startsWith(p.toUpperCase()));
}

export function paidStoragePrefixFilter(prefixes: string[] | undefined): string | null {
  if (!prefixes?.length) return null;
  const safe = prefixes.map((prefix) => prefix.replace(/[%,]/g, "").trim()).filter(Boolean);
  return safe.length ? safe.map((prefix) => `vendor_code.like.${prefix}%`).join(",") : null;
}

function paidStoragePrefixes(prefixes: string[] | undefined): string[] | null {
  if (!prefixes?.length) return null;
  const safe = prefixes.map((prefix) => prefix.replace(/[%,]/g, "").trim()).filter(Boolean);
  return safe.length ? safe : null;
}

function emptyWeekMap(weeks: MonthWeek[]): Record<string, number> {
  return Object.fromEntries(weeks.map((week) => [week.weekStart, 0]));
}

export function groupDailyStorageByWeek(
  rows: Array<{ date: string; warehouse_price: number | null }>,
  weeks: MonthWeek[],
): Record<string, number> {
  const map = emptyWeekMap(weeks);
  for (const row of rows) {
    const week = weeks.find((candidate) => row.date >= candidate.rangeFrom && row.date <= candidate.rangeTo);
    if (!week) continue;
    map[week.weekStart] = (map[week.weekStart] ?? 0) + Number(row.warehouse_price ?? 0);
  }
  return map;
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
  const prefixes = paidStoragePrefixes(brand.articlePrefixes);
  const prefixFilter = paidStoragePrefixFilter(brand.articlePrefixes);

  // В сырой таблице за месяц бывают сотни тысяч строк. Не передаём их все
  // через PostgREST: после owner-approved миграции Postgres вернёт максимум
  // одну агрегированную строку на день. До применения миграции сохраняем
  // совместимость и используем прежний постраничный запрос ниже.
  const daily = await client.rpc("opiu_paid_storage_daily", {
    p_cabinet_id: brand.cabinetId,
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_vendor_prefixes: prefixes,
  });
  if (!daily.error) {
    const dailyRows = (daily.data ?? []) as PaidStorageDailyRow[];
    if (!dailyRows.some((row) => row.source_ready)) return null;
    return groupDailyStorageByWeek(
      dailyRows
        .filter((row): row is PaidStorageDailyRow & { storage_date: string } => Boolean(row.storage_date))
        .map((row) => ({ date: row.storage_date, warehouse_price: row.warehouse_price })),
      weeks,
    );
  }

  // Не считаем отсутствие новой функции ошибкой экрана: код можно выкатить
  // раньше миграции, а отчёт продолжит работать (только медленнее).
  console.warn("[opiu] paid storage aggregate fallback:", daily.error.message);

  let rows: PaidStorageRow[];
  try {
    rows = await loadAllSupabasePages<PaidStorageRow>((from, to) => {
      let query = client
        .from("wb_paid_storage_rows")
        .select("id, date, vendor_code, warehouse_price")
        .eq("cabinet_id", brand.cabinetId)
        .gte("date", dateFrom)
        .lte("date", dateTo);
      // Суб-бренд раньше фильтровался уже после скачивания всего кабинета:
      // Norvia ждала 51 секунду ради 4,7 тыс. своих строк. Сужаем ответ в БД,
      // сохраняя тот же регистронезависимый префиксный критерий.
      if (prefixFilter) query = query.or(prefixFilter);
      return query
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
    }, { maxPages: 1_000, concurrency: 8, label: "ОПиУ: Платное хранение" });
  } catch (e) {
    // Таблица появляется отдельной миграцией (owner-approved) — до её
    // применения на проде это ожидаемо, откатываемся на storage_fee.
    console.error("[opiu] paid storage read:", e instanceof Error ? e.message : e);
    return null;
  }

  if (!rows.length) {
    // Пустой брендовый срез может быть честным нулём. Отличаем его от ещё не
    // синхронизированного кабинета отдельной дешёвой проверкой покрытия.
    const coverage = await client
      .from("wb_paid_storage_rows")
      .select("id")
      .eq("cabinet_id", brand.cabinetId)
      .gte("date", dateFrom)
      .lte("date", dateTo)
      .limit(1);
    if (coverage.error || !(coverage.data?.length)) return null;
  }

  return groupDailyStorageByWeek(
    rows.filter((row) => matchesVendorPrefix(row.vendor_code, brand.articlePrefixes)),
    weeks,
  );
}
