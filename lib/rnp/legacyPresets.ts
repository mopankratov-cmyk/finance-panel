// Прежние версии пресетов вида РНП (история lib/rnp/operatingMatrix.ts).
// В localStorage хранится список полей, а не id пресета: после правки пресета
// сохранённый выбор переставал узнаваться, превращался в «Свой вариант» и прятал
// новые строки. По этим спискам страница узнаёт старый пресет и подставляет текущий.
// Дополнять при каждой правке RNP_VIEW_PRESETS: сюда — прежний список полей.

export const RNP_LEGACY_PRESET_FIELDS: Readonly<Record<string, ReadonlyArray<readonly string[]>>> = {
  sales: [
    ["orders_sum", "orders_spp_sum", "orders_count", "orders_fbs_count", "orders_fbs_sum", "orders_fbw_count", "orders_fbw_sum", "fbs_share_pct", "cancels_count", "cancel_pct", "buyouts_gross_count", "buyouts_gross_rub", "buyouts_sum", "buyouts_count", "returns_count", "returns_sum", "return_pct", "buyout_pct", "actual_buyout_pct", "cohort_resolved_pct"],
    ["orders_sum", "orders_spp_sum", "orders_count", "orders_fbs_count", "orders_fbs_sum", "orders_fbw_count", "orders_fbw_sum", "fbs_share_pct", "cancels_count", "cancel_pct", "buyouts_gross_count", "buyouts_gross_rub", "buyouts_sum", "buyouts_count", "returns_count", "returns_sum", "return_pct", "buyout_pct", "actual_buyout_pct"],
    ["orders_sum", "orders_spp_sum", "orders_count", "cancels_count", "cancel_pct", "buyouts_gross_count", "buyouts_gross_rub", "buyouts_sum", "buyouts_count", "returns_count", "returns_sum", "return_pct", "buyout_pct", "actual_buyout_pct"],
    ["orders_sum", "orders_count", "cancels_count", "cancel_pct", "buyouts_sum", "buyouts_count", "returns_count", "returns_sum", "return_pct", "buyout_pct"],
  ],
  price: [
    ["orders_count", "avg_order_price", "seller_discount_pct", "avg_buyout_price", "final_price", "spp_pct"],
  ],
  conversion: [
    ["views", "clicks", "ctr", "open_card", "cart", "cart_cr", "order_cr", "org_open_card", "org_orders_count", "org_cr_pct", "org_share_pct", "orders_count", "buyout_pct"],
    ["views", "clicks", "ctr", "open_card", "cart", "cart_cr", "order_cr", "orders_count", "buyout_pct"],
    ["views", "clicks", "ctr", "open_card", "cart", "cart_cr", "orders_count", "buyout_pct"],
    ["views", "clicks", "ctr", "open_card", "cart", "orders_count", "buyout_pct"],
  ],
  ads: [
    ["views", "clicks", "ctr", "ad_orders", "ad_orders_sum", "open_card", "orders_sum", "orders_count", "ad_spent", "drr"],
    ["views", "clicks", "ctr", "open_card", "orders_sum", "orders_count", "ad_spent", "drr"],
  ],
  economy: [
    ["buyouts_sum", "cogs", "commission_rub", "acquiring_rub", "logistics_rub", "logistics_per_unit", "mp_cost_rub", "ad_spent", "gross", "tax_rub", "net_profit", "net_margin_pct", "profit_per_unit", "romi", "gmroi"],
    ["buyouts_sum", "cogs", "commission_rub", "acquiring_rub", "logistics_rub", "mp_cost_rub", "ad_spent", "gross", "tax_rub", "net_profit", "net_margin_pct", "profit_per_unit", "romi", "gmroi"],
    ["buyouts_sum", "cogs", "commission_rub", "acquiring_rub", "logistics_rub", "mp_cost_rub", "ad_spent", "gross", "margin_pct", "profit_per_unit", "romi", "gmroi"],
    ["orders_sum", "buyouts_sum", "gross", "margin_pct", "ad_spent", "drr", "money", "gmroi"],
  ],
  stock: [
    ["orders_count", "buyouts_count", "stock", "turnover", "money"],
  ],
};
