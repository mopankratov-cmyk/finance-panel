-- Воронка/РНП: сборка снимка шла 11-12 секунд на 12 SKU (замер ?timings=1:
-- totals_rpc 11218 мс, daily_sku 11271 мс).
--
-- Две причины:
-- 1. rnp_daily / rnp_daily_sku фильтровали wb_orders и wb_sales предикатом
--    date::date between: колонка timestamptz, каст отключает индекс, каждый
--    вызов сканировал историю целиком. Переписано полуинтервалом по сырой
--    колонке (усечение ::date идёт в UTC — границы те же сутки UTC, значения
--    не меняются). Первая версия правки пыталась строить индекс по выражению
--    date::date и падала: каст timestamptz→date не IMMUTABLE.
-- 2. Предикат (p_cabinet is null or cabinet_id = p_cabinet) в generic-плане
--    не сворачивается, и индекс по кабинету не используется. plan_cache_mode
--    = force_custom_plan заставляет планировать с фактическим значением
--    параметра: для конкретного кабинета остаётся cabinet_id = <uuid>.
--    Побочно функции перестают инлайниться — это ок, наружу они отдают
--    небольшие агрегаты.

create or replace function public.rnp_daily(p_from date, p_to date, p_cabinet uuid default null)
returns table(d date, orders_count int, orders_sum numeric, buyouts_count int, buyouts_sum numeric, ad_spent numeric)
language sql stable as $$
  with order_events as (
    select date::date d, nm_id,
      count(*)::int oc,
      sum(coalesce(price_with_disc, coalesce(total_price, 0) * (1 - coalesce(discount_percent, 0) / 100.0), 0)) os
    from public.wb_orders
    -- Полуинтервал по сырой колонке (timestamptz): date::date ломал индекс.
    -- Семантика та же: усечение ::date идёт в UTC, границы — те же сутки UTC.
    where date >= p_from::timestamptz and date < (p_to + 1)::timestamptz
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
    where date between p_from and p_to
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
    where date >= p_from::timestamptz and date < (p_to + 1)::timestamptz
      and sale_id like 'S%'
      and (p_cabinet is null or cabinet_id = p_cabinet)
    group by 1
  ),
  a as (
    select date::date d, sum(coalesce(spent, 0)) ad
    from public.wb_advert_nm_daily
    where date between p_from and p_to
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
      sum(coalesce(price_with_disc, coalesce(total_price, 0) * (1 - coalesce(discount_percent, 0) / 100.0), 0)) os
    from public.wb_orders
    -- Полуинтервал по сырой колонке (timestamptz): date::date ломал индекс.
    -- Семантика та же: усечение ::date идёт в UTC, границы — те же сутки UTC.
    where date >= p_from::timestamptz and date < (p_to + 1)::timestamptz
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
    where date between p_from and p_to
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
    where date >= p_from::timestamptz and date < (p_to + 1)::timestamptz
      and sale_id like 'S%'
      and (p_cabinet is null or cabinet_id = p_cabinet)
    group by 1, 2
  ),
  a as (
    select date::date d, nm_id, sum(coalesce(spent, 0)) ad
    from public.wb_advert_nm_daily
    where date between p_from and p_to
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


alter function public.rnp_daily(date, date, uuid) set plan_cache_mode = force_custom_plan;
alter function public.rnp_daily_sku(date, date, uuid) set plan_cache_mode = force_custom_plan;
alter function public.rnp_report(uuid) set plan_cache_mode = force_custom_plan;
