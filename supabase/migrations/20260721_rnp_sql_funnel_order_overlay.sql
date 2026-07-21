-- WB РНП: SQL-агрегаты должны считать заказы тем же источником, что и экран РНП.
--
-- После перехода РНП на WB Analytics → «Этапы воронки продаж» экран перестал
-- занижать заказы у Optima, но соседние экраны всё ещё брали rnp_report /
-- rnp_daily_sku, где заказы считались только из wb_orders. Это оставляло старое
-- расхождение в трендах, SEO, рынке, рекламе, поставках и части финансовых
-- прогнозов. Здесь повторяем тот же overlay на уровне SQL:
--   * если по SKU+дню есть wb_funnel_daily.orders/orders_sum — берём их;
--   * если воронка за день ещё не пришла — оставляем wb_orders как fallback;
--   * выкупы и реклама остаются из прежних источников.

create or replace function public.rnp_daily(p_from date, p_to date, p_cabinet uuid default null)
returns table(d date, orders_count int, orders_sum numeric, buyouts_count int, buyouts_sum numeric, ad_spent numeric)
language sql stable as $$
  with order_events as (
    select date::date d, nm_id,
      count(*)::int oc,
      sum(coalesce(total_price, 0) * (1 - coalesce(discount_percent, 0) / 100.0)) os
    from public.wb_orders
    where date::date between p_from and p_to
      and coalesce(is_cancel, false) = false
      and (p_cabinet is null or cabinet_id = p_cabinet)
    group by 1, 2
  ),
  funnel_orders as (
    select date::date d, nm_id,
      coalesce(sum(orders), 0)::int oc,
      coalesce(sum(orders_sum), 0) os,
      bool_or(orders is not null) has_orders_count,
      bool_or(orders_sum is not null) has_orders_sum
    from public.wb_funnel_daily
    where date::date between p_from and p_to
      and (p_cabinet is null or cabinet_id = p_cabinet)
    group by 1, 2
  ),
  order_keys as (
    select d, nm_id from order_events
    union
    select d, nm_id from funnel_orders
  ),
  order_daily as (
    select k.d, k.nm_id,
      case when coalesce(f.has_orders_count, false) then coalesce(f.oc, 0) else coalesce(o.oc, 0) end as oc,
      case when coalesce(f.has_orders_sum, false) then coalesce(f.os, 0) else coalesce(o.os, 0) end as os
    from order_keys k
    left join order_events o on o.d = k.d and o.nm_id = k.nm_id
    left join funnel_orders f on f.d = k.d and f.nm_id = k.nm_id
  ),
  o as (
    select d, sum(oc)::int oc, sum(os) os
    from order_daily
    group by 1
  ),
  s as (
    select date::date d, count(*)::int bc,
      sum(coalesce(price_with_disc, finished_price, 0)) bs
    from public.wb_sales
    where date::date between p_from and p_to
      and sale_id like 'S%'
      and (p_cabinet is null or cabinet_id = p_cabinet)
    group by 1
  ),
  a as (
    select date::date d, sum(coalesce(spent, 0)) ad
    from public.wb_advert_nm_daily
    where date::date between p_from and p_to
      and (p_cabinet is null or cabinet_id = p_cabinet)
    group by 1
  )
  select dd::date, coalesce(o.oc, 0), coalesce(o.os, 0),
    coalesce(s.bc, 0), coalesce(s.bs, 0), coalesce(a.ad, 0)
  from generate_series(p_from, p_to, interval '1 day') dd
  left join o on o.d = dd::date
  left join s on s.d = dd::date
  left join a on a.d = dd::date
  order by dd;
$$;

create or replace function public.rnp_daily_sku(p_from date, p_to date, p_cabinet uuid default null)
returns table(d date, nm_id bigint, orders_count int, orders_sum numeric, buyouts_count int, buyouts_sum numeric, ad_spent numeric)
language sql stable as $$
  with order_events as (
    select date::date d, nm_id,
      count(*)::int oc,
      sum(coalesce(total_price, 0) * (1 - coalesce(discount_percent, 0) / 100.0)) os
    from public.wb_orders
    where date::date between p_from and p_to
      and coalesce(is_cancel, false) = false
      and (p_cabinet is null or cabinet_id = p_cabinet)
    group by 1, 2
  ),
  funnel_orders as (
    select date::date d, nm_id,
      coalesce(sum(orders), 0)::int oc,
      coalesce(sum(orders_sum), 0) os,
      bool_or(orders is not null) has_orders_count,
      bool_or(orders_sum is not null) has_orders_sum
    from public.wb_funnel_daily
    where date::date between p_from and p_to
      and (p_cabinet is null or cabinet_id = p_cabinet)
    group by 1, 2
  ),
  order_keys as (
    select d, nm_id from order_events
    union
    select d, nm_id from funnel_orders
  ),
  order_daily as (
    select k.d, k.nm_id,
      case when coalesce(f.has_orders_count, false) then coalesce(f.oc, 0) else coalesce(o.oc, 0) end as oc,
      case when coalesce(f.has_orders_sum, false) then coalesce(f.os, 0) else coalesce(o.os, 0) end as os
    from order_keys k
    left join order_events o on o.d = k.d and o.nm_id = k.nm_id
    left join funnel_orders f on f.d = k.d and f.nm_id = k.nm_id
  ),
  s as (
    select date::date d, nm_id, count(*)::int bc,
      sum(coalesce(price_with_disc, finished_price, 0)) bs
    from public.wb_sales
    where date::date between p_from and p_to
      and sale_id like 'S%'
      and (p_cabinet is null or cabinet_id = p_cabinet)
    group by 1, 2
  ),
  a as (
    select date::date d, nm_id, sum(coalesce(spent, 0)) ad
    from public.wb_advert_nm_daily
    where date::date between p_from and p_to
      and (p_cabinet is null or cabinet_id = p_cabinet)
    group by 1, 2
  ),
  keys as (
    select d, nm_id from order_daily
    union
    select d, nm_id from s
    union
    select d, nm_id from a
  )
  select k.d, k.nm_id::bigint,
    coalesce(o.oc, 0), coalesce(o.os, 0), coalesce(s.bc, 0),
    coalesce(s.bs, 0), coalesce(a.ad, 0)
  from keys k
  left join order_daily o on o.d = k.d and o.nm_id = k.nm_id
  left join s on s.d = k.d and s.nm_id = k.nm_id
  left join a on a.d = k.d and a.nm_id = k.nm_id;
$$;

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
    date_trunc('day', now()) as today_start,
    date_trunc('day', now()) - interval '1 day' as yesterday_start,
    date_trunc('day', now()) - interval '6 days' as week_start,
    date_trunc('day', now()) - interval '29 days' as month_start
),
order_events as (
  select
    w.date::date d,
    w.nm_id,
    max(w.supplier_article) as article,
    count(*)::int as oc,
    coalesce(sum(coalesce(w.total_price, 0) * (1 - coalesce(w.discount_percent, 0) / 100.0)), 0) as os
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
  where w.date >= b.month_start::date
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
    coalesce(sum(od.oc) filter (where od.d >= b.today_start::date), 0)::int as c_today,
    coalesce(sum(od.os) filter (where od.d >= b.today_start::date), 0) as s_today,
    coalesce(sum(od.oc) filter (where od.d >= b.yesterday_start::date and od.d < b.today_start::date), 0)::int as c_yesterday,
    coalesce(sum(od.os) filter (where od.d >= b.yesterday_start::date and od.d < b.today_start::date), 0) as s_yesterday,
    coalesce(sum(od.oc) filter (where od.d >= b.week_start::date), 0)::int as c_week,
    coalesce(sum(od.os) filter (where od.d >= b.week_start::date), 0) as s_week,
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
    coalesce(sum(quantity), 0)::bigint as stock,
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
  where w.date >= b.month_start::date
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
