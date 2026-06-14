-- РНП по кабинету: добавляем опциональный p_cabinet uuid во все 3 функции.
-- p_cabinet = null → как раньше (все кабинеты скопом). Иначе фильтр cabinet_id = p_cabinet.
-- Безопасно прогнать повторно.

drop function if exists rnp_daily(date, date);
drop function if exists rnp_daily(date, date, uuid);
create function rnp_daily(p_from date, p_to date, p_cabinet uuid default null)
returns table(d date, orders_count int, orders_sum numeric, buyouts_count int, buyouts_sum numeric, ad_spent numeric)
language sql stable as $$
  with o as (select date::date d, count(*)::int oc,
      sum(coalesce(total_price,0)*(1-coalesce(discount_percent,0)/100.0)) os
    from wb_orders where date::date between p_from and p_to and coalesce(is_cancel,false)=false
      and (p_cabinet is null or cabinet_id = p_cabinet) group by 1),
  s as (select date::date d, count(*)::int bc, sum(coalesce(price_with_disc, finished_price, 0)) bs
    from wb_sales where date::date between p_from and p_to
      and (p_cabinet is null or cabinet_id = p_cabinet) group by 1),
  a as (select date::date d, sum(coalesce(spent,0)) ad
    from wb_advert_nm_daily where date::date between p_from and p_to
      and (p_cabinet is null or cabinet_id = p_cabinet) group by 1)
  select dd::date, coalesce(o.oc,0), coalesce(o.os,0), coalesce(s.bc,0), coalesce(s.bs,0), coalesce(a.ad,0)
  from generate_series(p_from,p_to,interval '1 day') dd
  left join o on o.d=dd::date left join s on s.d=dd::date left join a on a.d=dd::date order by dd;
$$;

drop function if exists rnp_daily_sku(date, date);
drop function if exists rnp_daily_sku(date, date, uuid);
create function rnp_daily_sku(p_from date, p_to date, p_cabinet uuid default null)
returns table(d date, nm_id bigint, orders_count int, orders_sum numeric, buyouts_count int, buyouts_sum numeric, ad_spent numeric)
language sql stable as $$
  with o as (select date::date d, nm_id, count(*)::int oc,
      sum(coalesce(total_price,0)*(1-coalesce(discount_percent,0)/100.0)) os
    from wb_orders where date::date between p_from and p_to and coalesce(is_cancel,false)=false
      and (p_cabinet is null or cabinet_id = p_cabinet) group by 1,2),
  s as (select date::date d, nm_id, count(*)::int bc, sum(coalesce(price_with_disc, finished_price, 0)) bs
    from wb_sales where date::date between p_from and p_to
      and (p_cabinet is null or cabinet_id = p_cabinet) group by 1,2),
  a as (select date::date d, nm_id, sum(coalesce(spent,0)) ad
    from wb_advert_nm_daily where date::date between p_from and p_to
      and (p_cabinet is null or cabinet_id = p_cabinet) group by 1,2)
  select coalesce(o.d,s.d,a.d), coalesce(o.nm_id,s.nm_id,a.nm_id)::bigint,
    coalesce(o.oc,0), coalesce(o.os,0), coalesce(s.bc,0), coalesce(s.bs,0), coalesce(a.ad,0)
  from o full join s on o.d=s.d and o.nm_id=s.nm_id
  full join a on coalesce(o.d,s.d)=a.d and coalesce(o.nm_id,s.nm_id)=a.nm_id;
$$;

drop function if exists public.rnp_report();
drop function if exists public.rnp_report(uuid);
create function public.rnp_report(p_cabinet uuid default null)
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
    and (p_cabinet is null or w.cabinet_id = p_cabinet)
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
    and (p_cabinet is null or w.cabinet_id = p_cabinet)
  group by w.nm_id
),
st as (
  select nm_id,
    coalesce(sum(quantity), 0)::bigint as stock,
    coalesce(sum(in_way_to_client), 0)::bigint as in_way
  from public.wb_stocks
  where (p_cabinet is null or cabinet_id = p_cabinet)
  group by nm_id
),
ad as (
  select w.nm_id, coalesce(sum(w.spent), 0) as spent
  from public.wb_advert_nm_daily w, bounds b
  where w.date >= b.month_start::date
    and (p_cabinet is null or w.cabinet_id = p_cabinet)
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
