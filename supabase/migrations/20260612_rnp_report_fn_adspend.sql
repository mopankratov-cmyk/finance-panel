-- Версия rnp_report c реальным расходом рекламы по nm_id (из wb_advert_nm_daily).
-- Меняется набор колонок → пересоздаём функцию.
drop function if exists public.rnp_report();

create function public.rnp_report()
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
language sql
stable
as $$
with bounds as (
  select
    date_trunc('day', now()) as today_start,
    date_trunc('day', now()) - interval '1 day' as yesterday_start,
    date_trunc('day', now()) - interval '6 days' as week_start,
    date_trunc('day', now()) - interval '29 days' as month_start
),
o as (
  select
    w.nm_id,
    max(w.supplier_article) as article,
    count(*) filter (where w.date >= b.today_start)::int as c_today,
    coalesce(sum(coalesce(w.finished_price, w.total_price)) filter (where w.date >= b.today_start), 0) as s_today,
    count(*) filter (where w.date >= b.yesterday_start and w.date < b.today_start)::int as c_yesterday,
    coalesce(sum(coalesce(w.finished_price, w.total_price)) filter (where w.date >= b.yesterday_start and w.date < b.today_start), 0) as s_yesterday,
    count(*) filter (where w.date >= b.week_start)::int as c_week,
    coalesce(sum(coalesce(w.finished_price, w.total_price)) filter (where w.date >= b.week_start), 0) as s_week,
    count(*)::int as c_month,
    coalesce(sum(coalesce(w.finished_price, w.total_price)), 0) as s_month
  from public.wb_orders w, bounds b
  where w.date >= b.month_start and not w.is_cancel
  group by w.nm_id
),
s as (
  select
    w.nm_id,
    count(*) filter (where w.date >= b.today_start)::int as c_today,
    coalesce(sum(coalesce(w.finished_price, w.for_pay)) filter (where w.date >= b.today_start), 0) as s_today,
    count(*) filter (where w.date >= b.yesterday_start and w.date < b.today_start)::int as c_yesterday,
    coalesce(sum(coalesce(w.finished_price, w.for_pay)) filter (where w.date >= b.yesterday_start and w.date < b.today_start), 0) as s_yesterday,
    count(*) filter (where w.date >= b.week_start)::int as c_week,
    coalesce(sum(coalesce(w.finished_price, w.for_pay)) filter (where w.date >= b.week_start), 0) as s_week,
    count(*)::int as c_month,
    coalesce(sum(coalesce(w.finished_price, w.for_pay)), 0) as s_month
  from public.wb_sales w, bounds b
  where w.date >= b.month_start
  group by w.nm_id
),
st as (
  select nm_id,
    coalesce(sum(quantity), 0)::bigint as stock,
    coalesce(sum(in_way_to_client), 0)::bigint as in_way
  from public.wb_stocks
  group by nm_id
),
ad as (
  select w.nm_id, coalesce(sum(w.spent), 0) as spent
  from public.wb_advert_nm_daily w, bounds b
  where w.date >= b.month_start::date
  group by w.nm_id
)
select
  coalesce(o.nm_id, s.nm_id, st.nm_id) as nm_id,
  coalesce(o.article, '') as article,
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
left join public.product_costs pc on pc.article = o.article
left join ad on ad.nm_id = coalesce(o.nm_id, s.nm_id)
$$;
