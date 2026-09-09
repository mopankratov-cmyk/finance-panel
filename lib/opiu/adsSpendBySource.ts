import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import type { MonthWeek } from "./weeks";
import type { OpiuBrand } from "./constants";

interface SpendHistoryRow {
  date: string;
  payment_type: string;
  amount: number;
  campaign_name: string | null;
}

export interface AdsSpendBySource {
  /** С баланса (реальные деньги продавца) — идёт в "ВБ продвижение" и вычитается из валовой прибыли. */
  balance: number;
  /** Промо-бонусами/кэшбэком WB — идёт в отдельную строку "Бонусы", в валовую прибыль НЕ входит. */
  bonus: number;
}

/**
 * Кампания относится к суб-бренду, если её название СОДЕРЖИТ артикул с
 * нужным префиксом — не startsWith: реальные названия вида "РС полки -
 * 755549645 куртка NV-816-04" несут артикул в середине строки. Это то же
 * самое, что владелец делает вручную при экспорте "Истории затрат" —
 * смотрит колонку "Кампания" и видит там артикул товара.
 *
 * Пробовали атрибутировать по advertId→nmId (wb_advert_nm_campaign_daily) —
 * на реальных данных давало кратно завышенные суммы: этот кабинет рекламирует
 * не только Norvia/Heaton, но и другие бренды (Supporto и др.), и связь
 * кампания↔товар в той таблице для части кампаний оказалась неточной/устаревшей.
 * Парсинг названия — прямой источник истины, тот же, каким пользуется владелец.
 */
function matchesVendorPrefix(campaignName: string | null, prefixes: string[] | undefined): boolean {
  if (!prefixes?.length) return true;
  if (!campaignName) return false;
  const normalized = campaignName.toUpperCase();
  return prefixes.some((p) => normalized.includes(p.toUpperCase()));
}

/**
 * Расход на рекламу по источнику списания (баланс/бонусы) — из "Истории
 * затрат" WB (adv/v1/upd), которая различает источник денег (в отличие от
 * fullstats/wb_advert_nm_daily, где баланс и бонусы смешаны в одну сумму).
 *
 * Возвращает null, если для кабинета в этом диапазоне дат вообще нет
 * синканных строк — вызывающий код должен в этом случае откатиться на
 * общий adsSpend из fullstats (см. aggregateWeek), а не показать 0.
 */
export async function fetchAdsSpendBySourceByWeek(
  brand: OpiuBrand,
  weeks: MonthWeek[],
): Promise<Record<string, AdsSpendBySource> | null> {
  if (!weeks.length) return {};
  const client = getSupabaseAdmin();
  if (!client) return null;

  const dateFrom = weeks[0]!.rangeFrom;
  const dateTo = weeks[weeks.length - 1]!.rangeTo;

  let rows: SpendHistoryRow[];
  try {
    rows = await loadAllSupabasePages<SpendHistoryRow>((from, to) => client
      .from("wb_advert_spend_history")
      .select("date, payment_type, amount, campaign_name")
      .eq("cabinet_id", brand.cabinetId)
      .gte("date", dateFrom)
      .lte("date", dateTo)
      .range(from, to), { maxPages: 1_000, label: "ОПиУ: История затрат на рекламу" });
  } catch (e) {
    // Таблица появляется отдельной миграцией (owner-approved) — до её
    // применения на проде это ожидаемо, откатываемся на fullstats.
    console.error("[opiu] ads spend history read:", e instanceof Error ? e.message : e);
    return null;
  }

  if (!rows.length) return null;

  const map: Record<string, AdsSpendBySource> = {};
  for (const w of weeks) map[w.weekStart] = { balance: 0, bonus: 0 };

  for (const row of rows) {
    if (!matchesVendorPrefix(row.campaign_name, brand.articlePrefixes)) continue;
    const week = weeks.find((w) => row.date >= w.rangeFrom && row.date <= w.rangeTo);
    if (!week) continue;
    const bucket = map[week.weekStart]!;
    // WB называет источник по-разному в разных кабинетах/версиях API:
    // "Промо бонусы" в одном, "Кэшбэк" в другом — оба не реальные деньги
    // продавца, оба — "бонусы". "Баланс" и "Счёт" — реальные деньги.
    const source = row.payment_type.toLowerCase();
    const isBonus = source.includes("бонус") || source.includes("кэшбэк") || source.includes("кешбэк");
    const amount = Number(row.amount ?? 0);
    if (isBonus) bucket.bonus += amount;
    else bucket.balance += amount;
  }

  return map;
}
