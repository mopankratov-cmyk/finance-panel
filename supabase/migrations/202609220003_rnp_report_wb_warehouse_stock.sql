-- rnp_report: остаток считается только по «Склад WB» (FBW и FBS).
--
-- Склады по городам (Коледино, Казань и так далее) после пожара пусты, а их
-- строки в отчёте WB — фантом (владелец, 21.09.2026, см. миграцию
-- 202609220002 и lib/wb/realStock.ts). Функция суммировала `quantity` по ВСЕМ
-- складским строкам, поэтому остаток и всё, что от него считается в «Поставках»
-- (need30/45/60, «хватит дней»), был завышен на величину фантома.
--
-- Меняется только CTE `st`: добавлен фильтр по названию склада. Остальное тело
-- функции — как в 20260726_zz_wb_rnp_price_with_disc_consistency.sql, без
-- изменений. «В пути к клиенту» WB не делит по складам, фильтр его не касается.

create or replace function public.rnp_report(p_cabinet uuid default null)
returns table (
  nm_id bigint,
  article text,
  orders_today int, orders_sum_today numeric,
  orders_yesterday int, orders_sum_yesterday numeric,
  orders_week int, orders_sum_week numeric,
  orders_month int, orders_sum_month numeric,
  buyouts_today int, buyouts_sum_today numeric,
  buyouts_yesterday int, buyouts_sum_yesterday numeric,
  buyouts_week int, buyouts_sum_week numeric,
  buyouts_month int, buyouts_sum_month numeric,
  stock bigint,
  in_way_to_client bigint,
  cost numeric,
  ad_spend_month numeric
)
language sql stable as $$
with bounds as (
  select
    date_trunc('day', now() at time zone 'Europe/Moscow') at time zone 'Europe/Moscow' as today_start,
    (date_trunc('day', now() at time zone 'Europe/Moscow') - interval '1 day') at time zone 'Europe/Moscow' as yesterday_start,
    (date_trunc('day', now() at time zone 'Europe/Moscow') - interval '6 days') at time zone 'Europe/Moscow' as week_start,
    (date_trunc('day', now() at time zone 'Europe/Moscow') - interval '29 days') at time zone 'Europe/Moscow' as month_start,
    (now() at time zone 'Europe/Moscow')::date as today_date,
    ((now() at time zone 'Europe/Moscow')::date - 1) as yesterday_date,
    ((now() at time zone 'Europe/Moscow')::date - 6) as week_date,
    ((now() at time zone 'Europe/Moscow')::date - 29) as month_date
),
order_events as (
  select
    w.date::date d,
    w.nm_id,
    max(w.supplier_article) as article,
    count(*)::int as oc,
    coalesce(sum(coalesce(w.price_with_disc, coalesce(w.total_price, 0) * (1 - coalesce(w.discount_percent, 0) / 100.0), 0)), 0) as os
  from public.wb_orders w, bounds b
  where w.date >= b.month_start
    and coalesce(w.is_cancel, false) = false
    and (p_cabinet is null or w.cabinet_id = p_cabinet)
  group by 1, 2
),
funnel_orders as (
  select
    w.date::date d,
    w.nm_id,
    coalesce(sum(w.orders), 0)::int as oc,
    coalesce(sum(w.orders_sum), 0) as os,
    bool_or(w.orders is not null) as has_orders_count,
    bool_or(w.orders_sum is not null) as has_orders_sum
  from public.wb_funnel_daily w, bounds b
  where w.date >= b.month_date
    and (p_cabinet is null or w.cabinet_id = p_cabinet)
  group by 1, 2
),
order_keys as (
  select d, nm_id from order_events
  union
  select d, nm_id from funnel_orders
),
order_daily as (
  select k.d, k.nm_id,
    o.article,
    case when coalesce(f.has_orders_count, false) then coalesce(f.oc, 0) else coalesce(o.oc, 0) end as oc,
    case when coalesce(f.has_orders_sum, false) then coalesce(f.os, 0) else coalesce(o.os, 0) end as os
  from order_keys k
  left join order_events o on o.d = k.d and o.nm_id = k.nm_id
  left join funnel_orders f on f.d = k.d and f.nm_id = k.nm_id
),
o as (
  select
    od.nm_id,
    max(od.article) filter (where nullif(od.article, '') is not null) as article,
    coalesce(sum(od.oc) filter (where od.d >= b.today_date), 0)::int as c_today,
    coalesce(sum(od.os) filter (where od.d >= b.today_date), 0) as s_today,
    coalesce(sum(od.oc) filter (where od.d >= b.yesterday_date and od.d < b.today_date), 0)::int as c_yesterday,
    coalesce(sum(od.os) filter (where od.d >= b.yesterday_date and od.d < b.today_date), 0) as s_yesterday,
    coalesce(sum(od.oc) filter (where od.d >= b.week_date), 0)::int as c_week,
    coalesce(sum(od.os) filter (where od.d >= b.week_date), 0) as s_week,
    coalesce(sum(od.oc), 0)::int as c_month,
    coalesce(sum(od.os), 0) as s_month
  from order_daily od, bounds b
  group by od.nm_id
),
s as (
  select
    w.nm_id,
    count(*) filter (where w.date >= b.today_start)::int as c_today,
    coalesce(sum(coalesce(w.price_with_disc, w.finished_price, 0)) filter (where w.date >= b.today_start), 0) as s_today,
    count(*) filter (where w.date >= b.yesterday_start and w.date < b.today_start)::int as c_yesterday,
    coalesce(sum(coalesce(w.price_with_disc, w.finished_price, 0)) filter (where w.date >= b.yesterday_start and w.date < b.today_start), 0) as s_yesterday,
    count(*) filter (where w.date >= b.week_start)::int as c_week,
    coalesce(sum(coalesce(w.price_with_disc, w.finished_price, 0)) filter (where w.date >= b.week_start), 0) as s_week,
    count(*)::int as c_month,
    coalesce(sum(coalesce(w.price_with_disc, w.finished_price, 0)), 0) as s_month
  from public.wb_sales w, bounds b
  where w.date >= b.month_start
    and w.sale_id like 'S%'
    and (p_cabinet is null or w.cabinet_id = p_cabinet)
  group by w.nm_id
),
st as (
  select nm_id,
    -- Остаток — только «Склад WB» (FBW и FBS). Склады по городам после пожара
    -- пусты, их строки в отчёте WB — фантом. Тот же признак, что в
    -- lib/wb/realStock.ts (WB_WAREHOUSE_SQL_PATTERN).
    coalesce(sum(quantity) filter (where warehouse ~* '^склад\s+(wb|вб)'), 0)::bigint as stock,
    -- «В пути к клиенту» WB не делит по складам — по всем строкам, как и раньше.
    coalesce(sum(in_way_to_client), 0)::bigint as in_way
  from public.wb_stocks
  where (p_cabinet is null or cabinet_id = p_cabinet)
  group by nm_id
),
meta as (
  select nm_id, max(article) filter (where nullif(article, '') is not null) as article
  from public.wb_cabinet_product_scope
  where (p_cabinet is null or cabinet_id = p_cabinet)
  group by nm_id
),
ad as (
  select w.nm_id, coalesce(sum(w.spent), 0) as spent
  from public.wb_advert_nm_daily w, bounds b
  where w.date >= b.month_date
    and (p_cabinet is null or w.cabinet_id = p_cabinet)
  group by w.nm_id
)
select
  coalesce(o.nm_id, s.nm_id, st.nm_id, ad.nm_id) as nm_id,
  coalesce(nullif(o.article, ''), meta.article, '') as article,
  coalesce(o.c_today, 0), coalesce(o.s_today, 0),
  coalesce(o.c_yesterday, 0), coalesce(o.s_yesterday, 0),
  coalesce(o.c_week, 0), coalesce(o.s_week, 0),
  coalesce(o.c_month, 0), coalesce(o.s_month, 0),
  coalesce(s.c_today, 0), coalesce(s.s_today, 0),
  coalesce(s.c_yesterday, 0), coalesce(s.s_yesterday, 0),
  coalesce(s.c_week, 0), coalesce(s.s_week, 0),
  coalesce(s.c_month, 0), coalesce(s.s_month, 0),
  coalesce(st.stock, 0),
  coalesce(st.in_way, 0),
  pc.cost_rub,
  coalesce(ad.spent, 0)
from o
full outer join s on s.nm_id = o.nm_id
full outer join st on st.nm_id = coalesce(o.nm_id, s.nm_id)
full outer join ad on ad.nm_id = coalesce(o.nm_id, s.nm_id, st.nm_id)
left join meta on meta.nm_id = coalesce(o.nm_id, s.nm_id, st.nm_id, ad.nm_id)
left join public.product_costs pc on pc.article = coalesce(nullif(o.article, ''), meta.article);
$$;
