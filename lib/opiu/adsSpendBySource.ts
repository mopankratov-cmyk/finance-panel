import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import type { MonthWeek } from "./weeks";
import type { OpiuBrand } from "./constants";

interface SpendHistoryRow {
  date: string;
  payment_type: string;
  amount: number;
}

interface FullstatsRow {
  date: string;
  nm_id: number;
  spent: number | null;
}

export interface AdsSpendBySource {
  /** С баланса (реальные деньги продавца) — идёт в "ВБ продвижение" и вычитается из валовой прибыли. */
  balance: number;
  /** Промо-бонусами/кэшбэком WB — идёт в отдельную строку "Бонусы", в валовую прибыль НЕ входит. */
  bonus: number;
}

/**
 * Расход на рекламу по источнику списания (баланс/бонусы) — из "Истории
 * затрат" WB (adv/v1/upd), которая различает источник денег, но списывается
 * ЦЕЛОЙ кампанией — не по nmId. На практике многие кампании этого кабинета
 * (особенно автокампании "Единая Ставка") продвигают товары НЕСКОЛЬКИХ
 * суб-брендов сразу (Norvia+Heaton на одном Retail Family) — атрибуция
 * "кампания → один суб-бренд" (пробовали через wb_advert_nm_campaign_daily)
 * на реальных данных удваивала сумму (кампания засчитывалась в оба
 * суб-бренда целиком).
 *
 * Вместо точной атрибуции по кампании — делим общую сумму кабинета
 * ПРОПОРЦИОНАЛЬНО доле суб-бренда в fullstats-расходе (wb_advert_nm_daily),
 * который, в отличие от "Истории затрат", уже корректно разложен по nmId.
 * Это оценка, а не точная сумма, но она несмещённая (доля бонусов/баланса
 * в общем расходе кампании — общекабинетная, для конкретного суб-бренда
 * WB её не публикует).
 *
 * Возвращает null, если для кабинета в этом диапазоне дат вообще нет
 * синканных строк "Истории затрат" — вызывающий код должен в этом случае
 * откатиться на общий adsSpend из fullstats (см. aggregateWeek), а не
 * показать 0.
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

  let historyRows: SpendHistoryRow[];
  try {
    historyRows = await loadAllSupabasePages<SpendHistoryRow>((from, to) => client
      .from("wb_advert_spend_history")
      .select("date, payment_type, amount")
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

  if (!historyRows.length) return null;

  // Доля суб-бренда по неделям — по умолчанию 1 (весь кабинет = сам бренд,
  // для Панкратова/Кучеренко, у которых нет articlePrefixes).
  let shareByWeek: Record<string, number> | null = null;
  if (nmIdWhitelist) {
    let fullstatsRows: FullstatsRow[];
    try {
      fullstatsRows = await loadAllSupabasePages<FullstatsRow>((from, to) => client
        .from("wb_advert_nm_daily")
        .select("date, nm_id, spent")
        .eq("cabinet_id", brand.cabinetId)
        .gte("date", dateFrom)
        .lte("date", dateTo)
        .range(from, to), { maxPages: 1_000, label: "ОПиУ: доля суб-бренда в рекламе" });
    } catch (e) {
      console.error("[opiu] fullstats share read:", e instanceof Error ? e.message : e);
      return null;
    }

    const totalByWeek = new Map<string, number>();
    const brandByWeek = new Map<string, number>();
    for (const row of fullstatsRows) {
      const week = weeks.find((w) => row.date >= w.rangeFrom && row.date <= w.rangeTo);
      if (!week) continue;
      const spent = Number(row.spent ?? 0);
      totalByWeek.set(week.weekStart, (totalByWeek.get(week.weekStart) ?? 0) + spent);
      if (nmIdWhitelist.has(Number(row.nm_id))) {
        brandByWeek.set(week.weekStart, (brandByWeek.get(week.weekStart) ?? 0) + spent);
      }
    }

    shareByWeek = {};
    for (const w of weeks) {
      const total = totalByWeek.get(w.weekStart) ?? 0;
      shareByWeek[w.weekStart] = total > 0 ? (brandByWeek.get(w.weekStart) ?? 0) / total : 0;
    }
  }

  const map: Record<string, AdsSpendBySource> = {};
  for (const w of weeks) map[w.weekStart] = { balance: 0, bonus: 0 };

  for (const row of historyRows) {
    const week = weeks.find((w) => row.date >= w.rangeFrom && row.date <= w.rangeTo);
    if (!week) continue;
    const share = shareByWeek ? shareByWeek[week.weekStart]! : 1;
    if (share === 0) continue;
    const bucket = map[week.weekStart]!;
    // WB называет источник по-разному в разных кабинетах/версиях API:
    // "Промо бонусы" в одном, "Кэшбэк" в другом — оба не реальные деньги
    // продавца, оба — "бонусы". "Баланс" и "Счёт" — реальные деньги.
    const source = row.payment_type.toLowerCase();
    const isBonus = source.includes("бонус") || source.includes("кэшбэк") || source.includes("кешбэк");
    const amount = Number(row.amount ?? 0) * share;
    if (isBonus) bucket.bonus += amount;
    else bucket.balance += amount;
  }

  return map;
}
