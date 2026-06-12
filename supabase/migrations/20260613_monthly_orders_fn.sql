-- Помесячный факт заказов по артикулу за год (для план/факт в планировании).
create or replace function public.monthly_orders(p_year int)
returns table (article text, month int, orders int, revenue numeric)
language sql
stable
as $$
  select
    w.supplier_article as article,
    extract(month from w.date)::int as month,
    count(*)::int as orders,
    coalesce(sum(coalesce(w.finished_price, w.total_price)), 0) as revenue
  from public.wb_orders w
  where w.supplier_article is not null
    and not w.is_cancel
    and extract(year from w.date) = p_year
  group by w.supplier_article, extract(month from w.date)
$$;
