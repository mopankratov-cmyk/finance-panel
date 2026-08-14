// Скидка Ozon — часть цены, которую площадка добивает за покупателя.
// Аналог СПП на WB (см. lib/unit/sppRates.ts): продавец получает свою цену,
// покупатель платит меньше, разницу закрывают баллы Ozon и софинансирование банка.
//
// Налог платится с того, что заплатил покупатель, поэтому юниту нужна именно эта доля.
//
// Единственный источник в Seller API — отчёт о реализации:
//   seller_price_per_instance            — цена продавца,
//   delivery_commission.price_per_instance — цена покупателя.
// Ни прайс кабинета (`marketing_price` там просто нет), ни financial_data отправлений
// цену покупателя не отдают: в отправлении лежит цена продавца, а скидки Ozon
// перечислены только текстом в `actions`, без сумм.
//
// Отчёт закрывается по итогам месяца, поэтому доля всегда с лагом: за текущий месяц
// Ozon отвечает 404. Это факт с задержкой, а не оценка — и так и подписано на экране.

import { ozonRealization, type OzonCreds, type OzonRealizationRow } from "@/lib/ozon/api";

export interface OzonBuyerDiscount {
  /** Доля скидки Ozon (0..1) по offer_id — только там, где отчёт дал обе цены. */
  byOffer: Map<string, number>;
  /** Доля по всему отчёту — фолбэк для товаров без строк за месяц. */
  overall: number | null;
  /** Месяц отчёта в формате YYYY-MM. null — отчёт получить не удалось. */
  period: string | null;
  /** Сколько offer_id получили собственную долю. */
  covered: number;
}

export const EMPTY_OZON_BUYER_DISCOUNT: OzonBuyerDiscount = {
  byOffer: new Map(), overall: null, period: null, covered: 0,
};

/** Доля скидки для товара: собственная, иначе средняя по отчёту. `null` — фактов нет. */
export function buyerDiscountForOffer(discount: OzonBuyerDiscount, offerId: string): number | null {
  return discount.byOffer.get(offerId) ?? discount.overall;
}

/** Цена, с которой платится налог: цена продавца за вычетом скидки Ozon. */
export function taxableOzonPrice(price: number, discountShare: number | null): number {
  if (!(price > 0)) return 0;
  if (discountShare == null) return price;
  return price * (1 - discountShare);
}

/** Скидка = 1 − оплата покупателя / цена продавца. Отрицательную не выдумываем — это 0. */
function shareFrom(sellerSum: number, buyerSum: number): number | null {
  if (!(sellerSum > 0) || !(buyerSum > 0)) return null;
  const share = 1 - buyerSum / sellerSum;
  if (!Number.isFinite(share)) return null;
  return Math.min(Math.max(share, 0), 0.95);
}

export function computeOzonBuyerDiscount(
  rows: readonly OzonRealizationRow[],
  period: string | null,
): OzonBuyerDiscount {
  const sums = new Map<string, { seller: number; buyer: number }>();
  let totalSeller = 0;
  let totalBuyer = 0;
  for (const row of rows) {
    const offerId = row.offerId;
    const quantity = row.quantity > 0 ? row.quantity : 1;
    const seller = row.sellerPricePerInstance * quantity;
    const buyer = row.pricePerInstance * quantity;
    if (!offerId || !(seller > 0) || !(buyer > 0)) continue;
    const current = sums.get(offerId) ?? { seller: 0, buyer: 0 };
    current.seller += seller;
    current.buyer += buyer;
    sums.set(offerId, current);
    totalSeller += seller;
    totalBuyer += buyer;
  }

  const byOffer = new Map<string, number>();
  for (const [offerId, { seller, buyer }] of sums) {
    const share = shareFrom(seller, buyer);
    if (share != null) byOffer.set(offerId, share);
  }

  return { byOffer, overall: shareFrom(totalSeller, totalBuyer), period, covered: byOffer.size };
}

/**
 * Берёт последний закрытый месяц с отчётом. Текущий месяц Ozon ещё не отдаёт,
 * поэтому отступаем назад — но не дальше трёх месяцев: доля годичной давности
 * уже не описывает сегодняшние цены.
 */
export async function loadOzonBuyerDiscount(
  creds: OzonCreds,
  now: Date = new Date(),
): Promise<OzonBuyerDiscount> {
  for (let back = 1; back <= 3; back++) {
    const probe = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const year = probe.getUTCFullYear();
    const month = probe.getUTCMonth() + 1;
    const report = await ozonRealization(creds, year, month);
    if (!report.ok || report.rows.length === 0) continue;
    const discount = computeOzonBuyerDiscount(report.rows, `${year}-${String(month).padStart(2, "0")}`);
    if (discount.covered > 0) return discount;
  }
  return EMPTY_OZON_BUYER_DISCOUNT;
}
