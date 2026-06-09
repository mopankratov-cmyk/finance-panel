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

export interface WbAdCount {
  adverts?: Array<{
    type?: number;
    status?: number;
    count?: number;
    advert_list?: Array<{ advertId?: number }>;
  }>;
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
