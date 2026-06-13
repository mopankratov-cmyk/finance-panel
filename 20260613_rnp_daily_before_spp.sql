-- РНП: «Заказы ₽» считаем от цены ДО СПП = total_price × (1 − discount_percent/100).
-- Данные уже в wb_orders (total_price, discount_percent) — пере-синк не нужен.
-- Выкупы (wb_sales) остаются по finished_price (до-СПП цены там нет).

drop function if exists rnp_daily(date, date);
drop function if exists rnp_daily(text, text);

create function rnp_daily(p_from date, p_to date)
returns table(d date, orders_count int, orders_sum numeric, buyouts_count int, buyouts_sum numeric, ad_spent numeric)
language sql stable as $$
  with o as (
    select date::date d, count(*)::int oc,
           sum(coalesce(total_price,0) * (1 - coalesce(discount_percent,0)/100.0)) os
    from wb_orders
    where date::date between p_from and p_to and coalesce(is_cancel,false) = false
    group by 1
  ),
  s as (
    select date::date d, count(*)::int bc, sum(coalesce(finished_price,0)) bs
    from wb_sales
    where date::date between p_from and p_to
    group by 1
  ),
  a as (
    select date::date d, sum(coalesce(spent,0)) ad
    from wb_advert_nm_daily
    where date::date between p_from and p_to
    group by 1
  )
  select dd::date,
         coalesce(o.oc,0), coalesce(o.os,0),
         coalesce(s.bc,0), coalesce(s.bs,0),
         coalesce(a.ad,0)
  from generate_series(p_from, p_to, interval '1 day') dd
  left join o on o.d = dd::date
  left join s on s.d = dd::date
  left join a on a.d = dd::date
  order by dd;
$$;

drop function if exists rnp_daily_sku(date, date);
drop function if exists rnp_daily_sku(text, text);

create function rnp_daily_sku(p_from date, p_to date)
returns table(d date, nm_id bigint, orders_count int, orders_sum numeric, buyouts_count int, buyouts_sum numeric, ad_spent numeric)
language sql stable as $$
  with o as (
    select date::date d, nm_id, count(*)::int oc,
           sum(coalesce(total_price,0) * (1 - coalesce(discount_percent,0)/100.0)) os
    from wb_orders
    where date::date between p_from and p_to and coalesce(is_cancel,false) = false
    group by 1,2
  ),
  s as (
    select date::date d, nm_id, count(*)::int bc, sum(coalesce(finished_price,0)) bs
    from wb_sales
    where date::date between p_from and p_to
    group by 1,2
  ),
  a as (
    select date::date d, nm_id, sum(coalesce(spent,0)) ad
    from wb_advert_nm_daily
    where date::date between p_from and p_to
    group by 1,2
  )
  select coalesce(o.d, s.d, a.d),
         coalesce(o.nm_id, s.nm_id, a.nm_id)::bigint,
         coalesce(o.oc,0), coalesce(o.os,0),
         coalesce(s.bc,0), coalesce(s.bs,0),
         coalesce(a.ad,0)
  from o
  full join s on o.d = s.d and o.nm_id = s.nm_id
  full join a on coalesce(o.d, s.d) = a.d and coalesce(o.nm_id, s.nm_id) = a.nm_id;
$$;
