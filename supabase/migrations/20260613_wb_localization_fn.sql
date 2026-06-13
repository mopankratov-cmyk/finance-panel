-- Агрегация заказов по региону+складу за 30 дней для страницы Локализации (ИЛ/ИРП).
-- Раньше роут постранично качал сырые wb_orders (~11k строк) по сети — рвалось/висло на 70с+.
create or replace function public.wb_localization_30d()
returns table (region text, warehouse text, cnt bigint)
language sql
stable
as $$
  select region, warehouse, count(*)::bigint
  from public.wb_orders
  where not is_cancel and date >= now() - interval '30 days'
  group by region, warehouse
$$;
