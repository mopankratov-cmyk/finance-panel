-- Дневная агрегация для матрицы РНП (как в inferno): по дню — заказы, выкупы, реклама.
create or replace function public.rnp_daily(p_from date, p_to date)
returns table (
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
  with days as (
    select generate_series(p_from, p_to, interval '1 day')::date as d
  ),
  o as (
    select date::date d, count(*) c, sum(coalesce(finished_price, total_price)) s
    from public.wb_orders
    where not is_cancel and date::date between p_from and p_to
    group by 1
  ),
  s as (
    select date::date d, count(*) c, sum(coalesce(finished_price, for_pay)) s
    from public.wb_sales
    where date::date between p_from and p_to
    group by 1
  ),
  a as (
    select date d, sum(spent) s
    from public.wb_advert_nm_daily
    where date between p_from and p_to
    group by 1
  )
  select
    days.d,
    coalesce(o.c, 0)::int,
    coalesce(o.s, 0),
    coalesce(s.c, 0)::int,
    coalesce(s.s, 0),
    coalesce(a.s, 0)
  from days
  left join o on o.d = days.d
  left join s on s.d = days.d
  left join a on a.d = days.d
  order by days.d
$$;
