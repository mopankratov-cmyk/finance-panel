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
// Скидка у каждого товара своя — в одном кабинете разброс от 20% до 63%. Поэтому
// среднюю по кабинету чужому товару НЕ подставляем: у товара либо есть собственный
// факт, либо доля неизвестна и налог считается от цены продавца (как раньше), но
// это видно по пустой цене покупателя и по счётчику покрытия.

import { ozonRealization, ozonRealizationByDay, type OzonCreds, type OzonRealizationRow } from "@/lib/ozon/api";

export interface OzonBuyerDiscount {
  /** Доля скидки Ozon (0..1) по offer_id — только там, где отчёт дал обе цены. */
  byOffer: Map<string, number>;
  /** Из каких отчётов собраны доли: «по дням» и/или закрытые месяцы. */
  sources: string[];
  /** Сколько offer_id получили собственную долю. */
  covered: number;
}

export const EMPTY_OZON_BUYER_DISCOUNT: OzonBuyerDiscount = { byOffer: new Map(), sources: [], covered: 0 };

/** Доля скидки товара. `null` — своего факта нет; чужую среднюю не подставляем. */
export function buyerDiscountForOffer(discount: OzonBuyerDiscount, offerId: string): number | null {
  return discount.byOffer.get(offerId) ?? null;
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

/** Суммы по товару за один отчёт: цены взвешиваются количеством, а не усредняются построчно. */
export function sumRealizationByOffer(rows: readonly OzonRealizationRow[]): Map<string, { seller: number; buyer: number }> {
  const sums = new Map<string, { seller: number; buyer: number }>();
  for (const row of rows) {
    const quantity = row.quantity > 0 ? row.quantity : 1;
    const seller = row.sellerPricePerInstance * quantity;
    const buyer = row.pricePerInstance * quantity;
    if (!row.offerId || !(seller > 0) || !(buyer > 0)) continue;
    const current = sums.get(row.offerId) ?? { seller: 0, buyer: 0 };
    current.seller += seller;
    current.buyer += buyer;
    sums.set(row.offerId, current);
  }
  return sums;
}

/**
 * Собирает доли из нескольких отчётов, от свежего к старому. Товар берёт долю из
 * самого свежего отчёта, где он вообще встречается: цены двигаются, и прошлогодняя
 * скидка описывает сегодняшнюю хуже, чем позавчерашняя.
 */
export function mergeBuyerDiscountSources(
  reports: ReadonlyArray<{ label: string; rows: readonly OzonRealizationRow[] }>,
): OzonBuyerDiscount {
  const byOffer = new Map<string, number>();
  const sources: string[] = [];
  for (const report of reports) {
    const sums = sumRealizationByOffer(report.rows);
    let added = 0;
    for (const [offerId, { seller, buyer }] of sums) {
      if (byOffer.has(offerId)) continue;
      const share = shareFrom(seller, buyer);
      if (share == null) continue;
      byOffer.set(offerId, share);
      added++;
    }
    if (added > 0) sources.push(`${report.label} (+${added})`);
  }
  return { byOffer, sources, covered: byOffer.size };
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Порядок источников: сначала реализация по дням (свежая, но доступна не на всех
 * тарифах), затем закрытые месяцы — они добирают товары, которых в свежем окне не было.
 */
export async function loadOzonBuyerDiscount(
  creds: OzonCreds,
  now: Date = new Date(),
): Promise<OzonBuyerDiscount> {
  const reports: Array<{ label: string; rows: readonly OzonRealizationRow[] }> = [];

  // По дням — запрос ограничен месяцем, поэтому текущий и прошлый месяц отдельно.
  for (const back of [0, 1]) {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back + 1, 0));
    const to = back === 0 ? now : monthEnd;
    const byDay = await ozonRealizationByDay(creds, isoDate(monthStart), isoDate(to));
    if (byDay.ok && byDay.rows.length > 0) {
      reports.push({ label: `по дням ${isoDate(monthStart)}…${isoDate(to)}`, rows: byDay.rows });
    } else if (!byDay.ok) {
      break; // метода нет на тарифе — второй запрос ничего не изменит
    }
  }

  // Закрытые месяцы добирают товары, которых не было в свежем окне.
  for (let back = 1; back <= 3; back++) {
    const probe = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const year = probe.getUTCFullYear();
    const month = probe.getUTCMonth() + 1;
    const report = await ozonRealization(creds, year, month);
    if (!report.ok || report.rows.length === 0) continue;
    reports.push({ label: `${year}-${String(month).padStart(2, "0")}`, rows: report.rows });
  }

  if (reports.length === 0) return EMPTY_OZON_BUYER_DISCOUNT;
  return mergeBuyerDiscountSources(reports);
}
