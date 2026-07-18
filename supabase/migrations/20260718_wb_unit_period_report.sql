create or replace function public.unit_report_period(
  p_cabinet uuid,
  p_from date,
  p_to date
)
returns table (
  nm_id bigint,
  article text,
  orders_month int,
  orders_sum_month numeric,
  buyouts_month int,
  stock bigint,
  in_way_to_client bigint,
  cost numeric,
  ad_spend_month numeric
)
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_from is null or p_to is null then
    raise exception 'period boundaries must not be null';
  end if;
  if p_from > p_to then
    raise exception 'period start must not be after period end';
  end if;
  if p_to > (now() at time zone 'Europe/Moscow')::date then
    raise exception 'period end must not be in the future';
  end if;
  if p_to - p_from + 1 > 31 then
    raise exception 'period must not exceed 31 days';
  end if;

  return query
  with active_cabinets as (
    select c.id
    from public.wb_cabinets as c
    where c.marketplace = 'wb'
      and c.is_active = true
      and (p_cabinet is null or c.id = p_cabinet)
  ),
  bounds as (
    select
      p_from::timestamp at time zone 'Europe/Moscow' as from_at,
      (p_to + 1)::timestamp at time zone 'Europe/Moscow' as to_at
  ),
  orders as (
    select
      o.nm_id,
      max(o.supplier_article) as article,
      count(*)::int as orders_count,
      coalesce(sum(coalesce(o.total_price, 0) * (1 - coalesce(o.discount_percent, 0) / 100.0)), 0) as orders_sum
    from public.wb_orders as o
    join active_cabinets as ac on ac.id = o.cabinet_id
    cross join bounds as b
    where o.date >= b.from_at and o.date < b.to_at
      and coalesce(o.is_cancel, false) = false
    group by o.nm_id
  ),
  sales as (
    select s.nm_id, count(*)::int as buyouts_count
    from public.wb_sales as s
    join active_cabinets as ac on ac.id = s.cabinet_id
    cross join bounds as b
    where s.date >= b.from_at and s.date < b.to_at
      and s.sale_id like 'S%'
    group by s.nm_id
  ),
  stocks as (
    select st.nm_id,
      coalesce(sum(st.quantity), 0)::bigint as stock_count,
      coalesce(sum(st.in_way_to_client), 0)::bigint as in_way_count
    from public.wb_stocks as st
    join active_cabinets as ac on ac.id = st.cabinet_id
    group by st.nm_id
  ),
  ads as (
    select a.nm_id, coalesce(sum(a.spent), 0) as ad_spent
    from public.wb_advert_nm_daily as a
    join active_cabinets as ac on ac.id = a.cabinet_id
    where a.date between p_from and p_to
    group by a.nm_id
  ),
  product_scope as (
    select ps.nm_id, max(ps.article) filter (where nullif(ps.article, '') is not null) as article
    from public.wb_cabinet_product_scope as ps
    join active_cabinets as ac on ac.id = ps.cabinet_id
    group by ps.nm_id
  ),
  products as (
    select o.nm_id from orders as o
    union select s.nm_id from sales as s
    union select st.nm_id from stocks as st
    union select a.nm_id from ads as a
    union select ps.nm_id from product_scope as ps
  )
  select
    p.nm_id,
    coalesce(nullif(o.article, ''), ps.article, '') as article,
    coalesce(o.orders_count, 0) as orders_month,
    coalesce(o.orders_sum, 0) as orders_sum_month,
    coalesce(s.buyouts_count, 0) as buyouts_month,
    coalesce(st.stock_count, 0) as stock,
    coalesce(st.in_way_count, 0) as in_way_to_client,
    pc.cost_rub as cost,
    coalesce(a.ad_spent, 0) as ad_spend_month
  from products as p
  left join orders as o on o.nm_id = p.nm_id
  left join sales as s on s.nm_id = p.nm_id
  left join stocks as st on st.nm_id = p.nm_id
  left join ads as a on a.nm_id = p.nm_id
  left join product_scope as ps on ps.nm_id = p.nm_id
  left join public.product_costs as pc on pc.article = coalesce(nullif(o.article, ''), ps.article);
end;
$$;

revoke execute on function public.unit_report_period(uuid, date, date) from public, anon, authenticated;
grant execute on function public.unit_report_period(uuid, date, date) to service_role;
