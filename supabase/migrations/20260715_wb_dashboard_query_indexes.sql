-- WB dashboards latency guardrails.
-- Interactive pages (/wb/rnp, /wb/adverts) filter large fact tables by cabinet_id
-- and a short date window. These indexes keep selected-cabinet dashboards on
-- indexed scans instead of broad table scans when cache warmup is running.

create index if not exists wb_orders_cabinet_date_nm_idx
  on public.wb_orders (cabinet_id, date, nm_id);

create index if not exists wb_sales_cabinet_date_nm_idx
  on public.wb_sales (cabinet_id, date, nm_id);

create index if not exists wb_advert_nm_daily_cabinet_date_nm_idx
  on public.wb_advert_nm_daily (cabinet_id, date, nm_id);

create index if not exists wb_funnel_daily_cabinet_date_nm_idx
  on public.wb_funnel_daily (cabinet_id, date, nm_id);

create index if not exists wb_stocks_cabinet_nm_idx
  on public.wb_stocks (cabinet_id, nm_id);

create index if not exists wb_advert_stats_cabinet_date_advert_idx
  on public.wb_advert_stats (cabinet_id, date, advert_id);

create index if not exists wb_adverts_cabinet_status_advert_idx
  on public.wb_adverts (cabinet_id, status, advert_id);

create index if not exists product_costs_article_idx
  on public.product_costs (article);
