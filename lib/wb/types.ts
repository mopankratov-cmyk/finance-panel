export interface WbApiResponse<T> {
  data: T | null;
  error: string | null;
  timestamp: string;
}

export interface WbReportRow {
  realizationreport_id?: number;
  date_from?: string;
  date_to?: string;
  create_dt?: string;
  order_dt?: string;
  sale_dt?: string;
  rr_dt?: string;
  rrd_id?: number;
  nm_id?: number;
  subject_name?: string;
  brand_name?: string;
  sa_name?: string;
  doc_type_name?: string;
  quantity?: number;
  retail_price?: number;
  retail_amount?: number;
  retail_price_withdisc_rub?: number;
  commission_percent?: number;
  ppvz_sales_commission?: number;
  delivery_rub?: number;
  ppvz_for_pay?: number;
  supplier_oper_name?: string;
  barcode?: string;
  office_name?: string;
  rebill_logistic_cost?: number;
  storage_fee?: number;
  penalty?: number;
  deduction?: number;
  additional_payment?: number;
  acceptance?: number;
  acquiring_fee?: number;
  /** Компенсация скидки по программе лояльности (WB отдаёт как cashbackDiscount). */
  cashback_discount?: number;
  [key: string]: unknown;
}

export interface WbOrder {
  date?: string;
  lastChangeDate?: string;
  warehouseName?: string;
  nmId?: number;
  subject?: string;
  category?: string;
  brand?: string;
  supplierArticle?: string;
  totalPrice?: number;
  discountPercent?: number;
  isCancel?: boolean;
  finishedPrice?: number;
  priceWithDisc?: number;
  spp?: number;
  [key: string]: unknown;
}

export interface WbStock {
  lastChangeDate?: string;
  warehouseName?: string;
  supplierArticle?: string;
  nmId?: number;
  barcode?: string;
  quantity?: number;
  inWayToClient?: number;
  inWayFromClient?: number;
  quantityFull?: number;
  category?: string;
  subject?: string;
  brand?: string;
  Price?: number;
  Discount?: number;
  [key: string]: unknown;
}

export interface WbAdvertItem {
  id?: number;
  advertId?: number;
  type?: number;
  status?: number;
  count?: number;
  settings?: { name?: string };
  advert_list?: Array<{ advertId?: number; changeTime?: string }>;
  [key: string]: unknown;
}

/** Ответ GET /api/advert/v2/adverts или legacy GET /adv/v1/promotion/count */
export interface WbAdvertsResponse {
  adverts?: WbAdvertItem[];
  all?: number;
}

/** @deprecated используйте WbAdvertsResponse */
export type WbAdCount = WbAdvertsResponse;

export function extractAdvertIds(ads: WbAdvertsResponse | null | undefined): number[] {
  if (!ads?.adverts) return [];
  const ids: number[] = [];
  for (const item of ads.adverts) {
    if (typeof item.id === "number") ids.push(item.id);
    else if (typeof item.advertId === "number") ids.push(item.advertId);
    else {
      item.advert_list?.forEach((ad) => {
        if (ad.advertId) ids.push(ad.advertId);
      });
    }
  }
  return [...new Set(ids)];
}

export interface WbAdStat {
  advertId?: number;
  views?: number;
  clicks?: number;
  ctr?: number;
  cpc?: number;
  sum?: number;
  atbs?: number;
  orders?: number;
  cr?: number;
  shks?: number;
  sum_price?: number;
  name?: string;
  days?: Array<{
    date?: string;
    views?: number;
    clicks?: number;
    sum?: number;
    orders?: number;
    sum_price?: number;
  }>;
  [key: string]: unknown;
}
