// СПП (скидка WB поверх цены продавца) по SKU — база для налога в юнит-экономике.
//
// Налог платится с суммы, которую фактически заплатил покупатель, то есть с цены
// ПОСЛЕ СПП, а не с цены продавца. В юните до сих пор налог считался от цены
// продавца (orders_sum / orders), и на товарах с большой СПП это давало заметно
// завышенный налог: у курток СПП доходит до 40%, значит и налог был на ~40% выше
// реального.
//
// Единственный источник СПП в базе — продажи: `price_with_disc` (цена продавца)
// против `finished_price` (фактическая оплата покупателя). Тот же расчёт, что и
// метрика «СПП, %» в РНП (см. lib/rnp/buildTable.ts), поэтому цифры сходятся.
//
// СПП считаем ПО КАЖДОМУ SKU: она различается в разы между товарами одного
// кабинета, и одна средняя ставка исказила бы налог сильнее, чем прежняя ошибка.

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";

export interface SppSourceRow {
  nm_id: number | string | null;
  price_with_disc: number | string | null;
  finished_price: number | string | null;
}

export interface UnitSppRates {
  /** Доля СПП (0..1) по nmID — только там, где в периоде есть продажи. */
  byNm: Map<number, number>;
  /** Доля СПП по всей выборке — фолбэк для SKU без продаж в периоде. */
  overall: number | null;
  /** Сколько SKU получили собственный факт СПП. */
  covered: number;
}

export const EMPTY_UNIT_SPP_RATES: UnitSppRates = { byNm: new Map(), overall: null, covered: 0 };

/**
 * Доля СПП для SKU: собственный факт, иначе средняя по выборке.
 * `null` — факта нет вообще, СПП неизвестна (и налог придётся считать от цены продавца).
 */
export function sppShareForNm(rates: UnitSppRates, nmId: number): number | null {
  const own = rates.byNm.get(nmId);
  return own ?? rates.overall;
}

/** Цена, с которой платится налог: цена продавца за вычетом СПП. */
export function taxableUnitPrice(price: number, sppShare: number | null): number {
  if (!(price > 0)) return 0;
  if (sppShare == null) return price;
  return price * (1 - sppShare);
}

const num = (value: number | string | null): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** СПП = 1 − оплата покупателя / цена продавца. Отрицательную (скидка «вверх») не выдумываем — это 0. */
function shareFrom(sellerSum: number, buyerSum: number): number | null {
  if (!(sellerSum > 0) || !(buyerSum > 0)) return null;
  const share = 1 - buyerSum / sellerSum;
  if (!Number.isFinite(share)) return null;
  return Math.min(Math.max(share, 0), 0.95);
}

export function computeUnitSppRates(rows: readonly SppSourceRow[]): UnitSppRates {
  const sums = new Map<number, { seller: number; buyer: number }>();
  let totalSeller = 0;
  let totalBuyer = 0;
  for (const row of rows) {
    const nmId = Number(row.nm_id);
    if (!Number.isFinite(nmId)) continue;
    const seller = num(row.price_with_disc ?? row.finished_price);
    const buyer = num(row.finished_price ?? row.price_with_disc);
    if (!(seller > 0) || !(buyer > 0)) continue;
    const current = sums.get(nmId) ?? { seller: 0, buyer: 0 };
    current.seller += seller;
    current.buyer += buyer;
    sums.set(nmId, current);
    totalSeller += seller;
    totalBuyer += buyer;
  }

  const byNm = new Map<number, number>();
  for (const [nmId, { seller, buyer }] of sums) {
    const share = shareFrom(seller, buyer);
    if (share != null) byNm.set(nmId, share);
  }

  return { byNm, overall: shareFrom(totalSeller, totalBuyer), covered: byNm.size };
}

export interface LoadUnitSppRatesInput {
  cabinetId: string | null;
  from: string;
  to: string;
  nmIds?: readonly number[] | null;
  label?: string;
}

const nextIsoDate = (date: string) => new Date(new Date(`${date}T00:00:00.000Z`).getTime() + 86_400_000).toISOString();

/**
 * Читает продажи периода и сводит их в ставки СПП.
 * Возвраты (`sale_id` R…) исключены: у них своя цена, и на цену покупки они не влияют.
 */
export async function loadUnitSppRates(
  db: SupabaseClient,
  input: LoadUnitSppRatesInput,
): Promise<UnitSppRates> {
  if (input.nmIds && input.nmIds.length === 0) return EMPTY_UNIT_SPP_RATES;
  const dateFrom = `${input.from}T00:00:00.000Z`;
  const dateTo = nextIsoDate(input.to);
  const rows = await loadAllSupabasePages<SppSourceRow>((start, end) => {
    let query = db
      .from("wb_sales")
      .select("nm_id, price_with_disc, finished_price")
      .gte("date", dateFrom)
      .lt("date", dateTo)
      .like("sale_id", "S%");
    if (input.cabinetId) query = query.eq("cabinet_id", input.cabinetId);
    if (input.nmIds && input.nmIds.length > 0) query = query.in("nm_id", [...input.nmIds]);
    return query.order("nm_id", { ascending: true }).range(start, end);
  }, { label: input.label ?? "Unit: СПП по продажам периода", maxPages: 100 });
  return computeUnitSppRates(rows);
}
