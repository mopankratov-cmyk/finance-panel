-- Дневная агрегация по каждому SKU (для блока ТОВАРЫ в РНП).
create or replace function public.rnp_daily_sku(p_from date, p_to date)
returns table (
  nm_id bigint,
  d date,
  orders_count int,
  orders_sum numeric,
  buyouts_count int,
  buyouts_sum numeric,
  ad_spent numeric
)
language sql
stable
as $$
  with o as (
    select nm_id, date::date d, count(*) c, sum(coalesce(finished_price, total_price)) s
    from public.wb_orders where not is_cancel and date::date between p_from and p_to group by 1, 2
  ),
  s as (
    select nm_id, date::date d, count(*) c, sum(coalesce(finished_price, for_pay)) s
    from public.wb_sales where date::date between p_from and p_to group by 1, 2
  ),
  a as (
    select nm_id, date d, sum(spent) s
    from public.wb_advert_nm_daily where date between p_from and p_to group by 1, 2
  ),
  keys as (
    select nm_id, d from o
    union select nm_id, d from s
    union select nm_id, d from a
  )
  select
    k.nm_id, k.d,
    coalesce(o.c, 0)::int, coalesce(o.s, 0),
    coalesce(s.c, 0)::int, coalesce(s.s, 0),
    coalesce(a.s, 0)
  from keys k
  left join o on o.nm_id = k.nm_id and o.d = k.d
  left join s on s.nm_id = k.nm_id and s.d = k.d
  left join a on a.nm_id = k.nm_id and a.d = k.d
$$;
