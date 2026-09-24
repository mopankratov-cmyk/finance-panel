import type { WbReportRow } from "@/lib/wb/types";
import {
  acceptanceRub,
  buildCostLookup,
  commissionResidualRub,
  docType,
  expenseRub,
  forPayRub,
  isClientCancelRow,
  num,
  penaltiesRub,
  qtyAbs,
  revenueRub,
  revenueWithoutSppRub,
  storageFeeRub,
  transitDeliveryRub,
  unitCost,
  unitPackaging,
  type ProductCostRow,
} from "./metrics";

/**
 * «Маржа по артикулам» — та же методология, что и у ОПиУ (docType-агрегация
 * по финотчёту WB, sale/return со знаком), но на уровне баркода, а не всего
 * кабинета. Формула сверена построчно с гугл-таблицей «Маржа по артикулам
 * (артикул ВБ)» — «Итого к оплате», «Маржинальная прибыль» и «Чистая прибыль»
 * из этого модуля дают те же цифры, что и «Итого» строка таблицы.
 */
export interface MarginRow {
  nmId: number;
  article: string;
  barcode: string;
  /** Заказы за период (шт/руб) — из wb_orders, на уровне nm_id (баркода в заказах нет). */
  ordersQty: number;
  ordersRub: number;
  /** Отказы, шт — строки финотчёта с bonus_type_name «От клиента при отмене». */
  cancelQty: number;
  salesQty: number;
  returnsQty: number;
  netQty: number;
  /** Итого продаж / Заказы, % — как в гугл-таблице (не Продажи / (Продажи + Возвраты)). */
  buyoutPct: number | null;
  salesRub: number;
  returnsRub: number;
  revenueWithoutSpp: number;
  revenueAfterSpp: number;
  forPay: number;
  commission: number;
  commissionPct: number | null;
  /** Доставок, шт — WB-поле delivery_amount (не quantity): число физических доставок, не единиц. */
  deliveryCount: number;
  logistics: number;
  logisticsPerUnit: number | null;
  penalties: number;
  additionalPayments: number;
  storage: number;
  storagePct: number | null;
  storagePerUnit: number | null;
  acceptance: number;
  acceptancePerUnit: number | null;
  transit: number;
  /** К перечислению − логистика − штрафы − доплаты − хранение − приёмка − транзит. */
  totalPayout: number;
  cost: number;
  packaging: number;
  marginalProfit: number;
  marginPctBeforeTax: number | null;
  tax: number;
  netProfit: number;
  netProfitPerUnit: number | null;
  netMarginPct: number | null;
  adSpend: number;
  /**
   * (Выручка без СПП − Комиссия − Логистика − Себестоимость − Подготовка) /
   * Выручка без СПП, % — столбец «Маржа без учёта Хранения» из гугл-таблицы:
   * быстрая маржа без штрафов/доплат/хранения/приёмки/транзита/налога/рекламы.
   */
  marginPctExStorage: number | null;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * taxPct — ставка налога с «Выручки после СПП» (то, что заплатил покупатель).
 * В гугл-таблице зашита буквально как 6% (УСН «доходы») — сверено на «Итого»
 * строке: Налог = Выручка после СПП × 6% с точностью до копейки.
 */
export interface MarginByBarcodeResult {
  rows: MarginRow[];
  /** Строк финотчёта, где нет ни баркода, ни nm_id — деньги реальны, но привязать не к чему. */
  unattributedRows: number;
}

export interface OrdersSummary {
  ordersQty: number;
  ordersRub: number;
}

export function buildMarginByBarcode(
  rows: WbReportRow[],
  costs: ProductCostRow[],
  adSpendByNmId: Map<number, number>,
  ordersByNmId: Map<number, OrdersSummary> = new Map(),
  paidStorageByArticle: Map<string, number> = new Map(),
  taxPct = 6,
): MarginByBarcodeResult {
  const lookup = buildCostLookup(costs);
  // Не все строки финотчёта несут баркод — «Хранение», «Транзит» и часть
  // штрафов WB привязывает только к nm_id, без конкретного размера. Группируем
  // такие строки по nm_id (ключ "nm:<id>"), а не отбрасываем: иначе реальные
  // деньги (например, вся сумма «Хранения» за период) тихо пропадали бы из
  // отчёта. Настоящий баркод в псевдо-строке "nm:<id>" не показываем.
  const byBarcode = new Map<string, WbReportRow[]>();
  let unattributedRows = 0;
  for (const row of rows) {
    const barcode = String(row.barcode ?? "").trim();
    const nmId = Number(row.nm_id) || 0;
    const key = barcode || (nmId > 0 ? `nm:${nmId}` : "");
    if (!key) {
      unattributedRows += 1;
      continue;
    }
    const list = byBarcode.get(key);
    if (list) list.push(row);
    else byBarcode.set(key, [row]);
  }

  const result: MarginRow[] = [];
  const adSpendUsedForNmId = new Set<number>();
  // Заказы приходят на уровне nm_id (в wb_orders нет баркода) — как и с
  // рекламой, если у nm_id несколько баркодов, сумма приписывается только
  // первой встреченной группе, иначе она задвоилась бы по числу баркодов.
  // Отказы, в отличие от Заказов, считаются из строк финотчёта — они уже
  // на уровне баркода, дедуп им не нужен.
  const ordersUsedForNmId = new Set<number>();
  // «Хранение» — по артикулу (wb_paid_storage_rows.vendor_code = sa_name), не
  // по баркоду: если у артикула несколько размеров/баркодов, сумма
  // приписывается только первой встреченной группе — тот же приём, что и
  // выше для Заказов/Рекламы (иначе задвоилась бы по числу баркодов).
  const storageUsedForArticle = new Set<string>();

  for (const [key, group] of byBarcode) {
    const first = group[0]!;
    const nmId = Number(first.nm_id) || 0;
    const article = String(first.sa_name ?? "").trim();
    const barcode = key.startsWith("nm:") ? "" : key;

    let salesQty = 0;
    let returnsQty = 0;
    let salesRub = 0;
    let returnsRub = 0;
    let revenueWithoutSpp = 0;
    let revenueAfterSpp = 0;
    let forPay = 0;
    let commission = 0;
    let cancelQty = 0;
    let deliveryCount = 0;
    let logistics = 0;
    let penalties = 0;
    let additionalPayments = 0;
    let storageFallback = 0;
    let acceptance = 0;
    let transit = 0;
    let cost = 0;
    let packaging = 0;

    for (const row of group) {
      const type = docType(row);
      const qty = qtyAbs(row);
      // «Продажи»/«Возвраты», руб — цена ДО СПП (retail_price_withdisc_rub),
      // не сумма после СПП (retail_amount). Сверено с гугл-таблицей построчно
      // (TT04101: 3 582,86 ₽ — совпало день в день); revenueAfterSpp ниже
      // по-прежнему считает через retail_amount отдельно, это разные метрики.
      const gross = num(row.retail_price_withdisc_rub) * qty;
      if (type === "sale") {
        salesQty += qty;
        salesRub += gross;
        cost += unitCost(row, lookup) * qty;
        packaging += unitPackaging(row, lookup) * qty;
      } else if (type === "return") {
        returnsQty += qty;
        returnsRub += gross;
        // Возврат уменьшает себестоимость/подготовку так же, как выручку —
        // товар вернулся, и его затраты не должны оставаться в марже.
        cost -= unitCost(row, lookup) * qty;
        packaging -= unitPackaging(row, lookup) * qty;
      }
      revenueWithoutSpp += revenueWithoutSppRub(row);
      revenueAfterSpp += revenueRub(row);
      forPay += forPayRub(row);
      commission += commissionResidualRub(row);
      if (isClientCancelRow(row)) cancelQty += 1;
      deliveryCount += Math.max(0, Math.round(num(row.delivery_amount)));
      logistics += expenseRub(row.delivery_rub);
      penalties += expenseRub(row.penalty);
      additionalPayments += expenseRub(row.additional_payment);
      storageFallback += storageFeeRub(row);
      acceptance += acceptanceRub(row);
      transit += transitDeliveryRub(row);
    }

    // «Хранение» — приоритет wb_paid_storage_rows (отчёт WB «Платное
    // хранение», по артикулу): storage_fee из финотчёта обезличен на весь
    // кабинет (nm_id: 0) и по артикулу всегда ~0 — сверено на реальных
    // данных (TT04102, 07-13.09: storage_fee давал 0, «Платное хранение» —
    // 730,05 ₽, ровно как в официальной выгрузке WB и в гугл-таблице).
    // Откат на storageFallback только если по артикулу вообще нет записей
    // в wb_paid_storage_rows — отличаем «не синкано» от «синкано и правда 0».
    const articleKey = article.toUpperCase();
    const hasPaidStorage = paidStorageByArticle.has(articleKey);
    const storage = storageUsedForArticle.has(articleKey)
      ? 0
      : hasPaidStorage
        ? paidStorageByArticle.get(articleKey)!
        : storageFallback;
    storageUsedForArticle.add(articleKey);

    const netQty = salesQty - returnsQty;
    const totalPayout = forPay - logistics - penalties - additionalPayments - storage - acceptance - transit;
    const marginalProfit = totalPayout - cost - packaging;
    const tax = revenueAfterSpp * (taxPct / 100);
    const netProfit = marginalProfit - tax;
    const adSpend = adSpendUsedForNmId.has(nmId) ? 0 : (adSpendByNmId.get(nmId) ?? 0);
    adSpendUsedForNmId.add(nmId);

    const orders = ordersUsedForNmId.has(nmId) ? undefined : ordersByNmId.get(nmId);
    ordersUsedForNmId.add(nmId);
    const ordersQty = orders?.ordersQty ?? 0;

    result.push({
      nmId,
      article,
      barcode,
      ordersQty,
      ordersRub: round2(orders?.ordersRub ?? 0),
      cancelQty,
      salesQty,
      returnsQty,
      netQty,
      buyoutPct: ordersQty > 0 ? round2((netQty / ordersQty) * 100) : null,
      salesRub: round2(salesRub),
      returnsRub: round2(returnsRub),
      revenueWithoutSpp: round2(revenueWithoutSpp),
      revenueAfterSpp: round2(revenueAfterSpp),
      forPay: round2(forPay),
      commission: round2(commission),
      commissionPct: revenueWithoutSpp > 0 ? round2((commission / revenueWithoutSpp) * 100) : null,
      deliveryCount,
      logistics: round2(logistics),
      logisticsPerUnit: netQty > 0 ? round2(logistics / netQty) : null,
      penalties: round2(penalties),
      additionalPayments: round2(additionalPayments),
      storage: round2(storage),
      storagePct: revenueWithoutSpp > 0 ? round2((storage / revenueWithoutSpp) * 100) : null,
      storagePerUnit: netQty > 0 ? round2(storage / netQty) : null,
      acceptance: round2(acceptance),
      acceptancePerUnit: netQty > 0 ? round2(acceptance / netQty) : null,
      transit: round2(transit),
      totalPayout: round2(totalPayout),
      cost: round2(cost),
      packaging: round2(packaging),
      marginalProfit: round2(marginalProfit),
      marginPctBeforeTax: revenueWithoutSpp > 0 ? round2((marginalProfit / revenueWithoutSpp) * 100) : null,
      tax: round2(tax),
      netProfit: round2(netProfit),
      netProfitPerUnit: netQty > 0 ? round2(netProfit / netQty) : null,
      netMarginPct: revenueWithoutSpp > 0 ? round2((netProfit / revenueWithoutSpp) * 100) : null,
      adSpend: round2(adSpend),
      marginPctExStorage:
        revenueWithoutSpp > 0
          ? round2(((revenueWithoutSpp - commission - logistics - cost - packaging) / revenueWithoutSpp) * 100)
          : null,
    });
  }

  return {
    rows: result.sort((a, b) => b.revenueWithoutSpp - a.revenueWithoutSpp),
    unattributedRows,
  };
}
