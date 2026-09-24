-- ОПиУ раньше скачивал из wb_paid_storage_rows все строки кабинета за месяц
-- (у Оптимы их больше 120 тыс.) и суммировал их в Node.js. Для брендового
-- среза это занимало десятки секунд. Возвращаем из Postgres не сырой слой,
-- а максимум одну агрегированную строку на день.

create or replace function public.opiu_paid_storage_daily(
  p_cabinet_id uuid,
  p_date_from date,
  p_date_to date,
  p_vendor_prefixes text[] default null
)
returns table (
  source_ready boolean,
  storage_date date,
  warehouse_price numeric
)
language plpgsql
stable
set search_path = ''
set plan_cache_mode = force_custom_plan
as $$
begin
  if p_cabinet_id is null or p_date_from is null or p_date_to is null then
    raise exception 'cabinet and period boundaries must not be null';
  end if;
  if p_date_from > p_date_to then
    raise exception 'period start must not be after period end';
  end if;
  if p_date_to - p_date_from + 1 > 62 then
    raise exception 'period must not exceed 62 days';
  end if;

  return query
  with coverage as materialized (
    select exists (
      select 1
      from public.wb_paid_storage_rows as r
      where r.cabinet_id = p_cabinet_id
        and r.date between p_date_from and p_date_to
    ) as ready
  ),
  daily as (
    select
      r.date as storage_date,
      coalesce(sum(r.warehouse_price), 0) as warehouse_price
    from public.wb_paid_storage_rows as r
    where r.cabinet_id = p_cabinet_id
      and r.date between p_date_from and p_date_to
      and (
        coalesce(cardinality(p_vendor_prefixes), 0) = 0
        or exists (
          select 1
          from unnest(p_vendor_prefixes) as prefix(value)
          where r.vendor_code like prefix.value || '%'
        )
      )
    group by r.date
  )
  select coverage.ready, daily.storage_date, daily.warehouse_price
  from coverage
  left join daily on true
  order by daily.storage_date;
end;
$$;

comment on function public.opiu_paid_storage_daily(uuid, date, date, text[]) is
  'Суточный агрегат платного хранения WB для ОПиУ; не передаёт сырой многотысячный отчёт через PostgREST.';

revoke execute on function public.opiu_paid_storage_daily(uuid, date, date, text[]) from public, anon, authenticated;
grant execute on function public.opiu_paid_storage_daily(uuid, date, date, text[]) to service_role;

notify pgrst, 'reload schema';
