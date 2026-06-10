import type { WbAdStat, WbAdvertsResponse, WbOrder, WbReportRow } from "./types";

/** Оставляем только поля, нужные аналитике — меньше JSON в Supabase */
export function trimSales(rows: WbReportRow[]): WbReportRow[] {
  return rows.map((r) => ({
    nm_id: r.nm_id,
    sale_dt: r.sale_dt,
    order_dt: r.order_dt,
    create_dt: r.create_dt,
    sa_name: r.sa_name,
    brand_name: r.brand_name,
    subject_name: r.subject_name,
    doc_type_name: r.doc_type_name,
    supplier_oper_name: r.supplier_oper_name,
    quantity: r.quantity,
    retail_amount: r.retail_amount,
    ppvz_for_pay: r.ppvz_for_pay,
    ppvz_sales_commission: r.ppvz_sales_commission,
    delivery_rub: r.delivery_rub,
  }));
}

export function trimOrders(rows: WbOrder[]): WbOrder[] {
  return rows.map((o) => ({
    date: o.date,
    nmId: o.nmId,
    isCancel: o.isCancel,
    supplierArticle: o.supplierArticle,
    lastChangeDate: o.lastChangeDate,
    warehouseName: o.warehouseName,
  }));
}

export function trimAdverts(ads: WbAdvertsResponse): WbAdvertsResponse {
  return {
    adverts: ads.adverts?.map((a) => ({
      id: a.id,
      advertId: a.advertId,
      advert_list: a.advert_list,
    })),
    all: ads.all,
  };
}

export function trimAdStats(stats: WbAdStat[]): WbAdStat[] {
  return stats.map((s) => ({
    advertId: s.advertId,
    name: s.name,
    views: s.views,
    clicks: s.clicks,
    sum: s.sum,
    orders: s.orders,
    sum_price: s.sum_price,
    days: s.days?.map((d) => ({
      date: d.date,
      views: d.views,
      clicks: d.clicks,
      sum: d.sum,
      orders: d.orders,
      sum_price: d.sum_price,
    })),
  }));
}
