import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import type { MonthWeek } from "./weeks";
import type { OpiuBrand } from "./constants";

interface SpendHistoryRow {
  date: string;
  advert_id: number;
  payment_type: string;
  amount: number;
}

interface CampaignRow {
  advert_id: number;
  nm_id: number;
}

export interface AdsSpendBySource {
  /** С баланса (реальные деньги продавца) — идёт в "ВБ продвижение" и вычитается из валовой прибыли. */
  balance: number;
  /** Промо-бонусами WB — идёт в отдельную строку "Бонусы", в валовую прибыль НЕ входит. */
  bonus: number;
}

/**
 * Расход на рекламу по источнику списания (баланс/бонусы) — из "Истории
 * затрат" WB (adv/v1/upd), которая, в отличие от wb_advert_nm_daily
 * (fullstats), различает источник денег, но не делит списание по nmId
 * внутри кампании — только по кампании целиком.
 *
 * Возвращает null, если для кабинета в этом диапазоне дат вообще нет
 * синканных строк — вызывающий код должен в этом случае откатиться на
 * общий adsSpend из fullstats (см. aggregateWeek), а не показать 0.
 */
export async function fetchAdsSpendBySourceByWeek(
  brand: OpiuBrand,
  weeks: MonthWeek[],
  nmIdWhitelist?: Set<number>,
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
      .select("date, advert_id, payment_type, amount")
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

  let allowedAdvertIds: Set<number> | undefined;
  if (nmIdWhitelist) {
    // "История затрат" списывается ЦЕЛОЙ кампанией, не по nmId — если
    // кампания продвигает товары нескольких суб-брендов сразу (общая РК на
    // несколько артикулов), её расход попадёт в оба суб-бренда сразу. Для
    // типичных одноартикульных кампаний этого кабинета (см. названия РК —
    // каждая ведёт один товар) это не проблема, но стоит иметь в виду.
    let campaignRows: CampaignRow[];
    try {
      campaignRows = await loadAllSupabasePages<CampaignRow>((from, to) => client
        .from("wb_advert_nm_campaign_daily")
        .select("advert_id, nm_id")
        .eq("cabinet_id", brand.cabinetId)
        .gte("date", dateFrom)
        .lte("date", dateTo)
        .range(from, to), { maxPages: 1_000, label: "ОПиУ: кампании суб-бренда" });
    } catch (e) {
      console.error("[opiu] campaign nm read:", e instanceof Error ? e.message : e);
      return null;
    }
    allowedAdvertIds = new Set(
      campaignRows
        .filter((r) => nmIdWhitelist.has(Number(r.nm_id)))
        .map((r) => Number(r.advert_id)),
    );
  }

  const map: Record<string, AdsSpendBySource> = {};
  for (const w of weeks) map[w.weekStart] = { balance: 0, bonus: 0 };

  for (const row of rows) {
    if (allowedAdvertIds && !allowedAdvertIds.has(Number(row.advert_id))) continue;
    const week = weeks.find((w) => row.date >= w.rangeFrom && row.date <= w.rangeTo);
    if (!week) continue;
    const bucket = map[week.weekStart]!;
    // WB называет источник по-разному в разных кабинетах/версиях API:
    // "Промо бонусы" в одном, "Кэшбэк" в другом — оба не реальные деньги
    // продавца, оба — "бонусы". "Баланс" и "Счёт" — реальные деньги.
    const source = row.payment_type.toLowerCase();
    const isBonus = source.includes("бонус") || source.includes("кэшбэк") || source.includes("кешбэк");
    if (isBonus) bucket.bonus += Number(row.amount ?? 0);
    else bucket.balance += Number(row.amount ?? 0);
  }

  return map;
}
