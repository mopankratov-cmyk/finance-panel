-- РНП: настоящий «Фактический % выкупа» и «Логистика на единицу».
--
-- 1) Фактический % выкупа был «(продажи − возвраты) / продажи», то есть ровно
--    100% − «Доля возвратов». Отказы и отмены на ПВЗ — основная масса
--    невыкупа у одежды — в него не попадали вовсе: Retail Family 11–17.09
--    показывал 89.7% при 56 возвратах на 545 продаж. Здесь — когорта заказов
--    по дате заказа, как считает сам WB: каждый заказ сопоставляется с
--    продажами по srid, выкуплено и не возвращено / заказы с известным итогом
--    (выкуп, возврат, отмена/отказ). Заказы «в пути» в знаменатель не входят.
--
-- 2) «Логистика на единицу» — вся логистика финотчёта (туда и обратно,
--    delivery_rub со знаком, как в ОПиУ) / проданные штуки из тех же строк
--    отчёта (продажи − возвраты). Невыкуп учтён сам собой: доставки отказов
--    и обратная логистика уже в сумме. rebill_logistic_cost не входит — так
--    же, как в ОПиУ (lib/opiu/metrics.ts).
--
-- Обе метрики агрегируются в базе: у Оптимы ~10 тыс. заказов в неделю и
-- ~116 тыс. строк финотчёта в день — построчно РНП упал бы по таймауту.

-- Когорта заказов с итогом. cohort_kept_open — выкуплено, но окно возврата
-- (21 день от выкупа) ещё открыто: такой выкуп в процент входит, а вот
-- «итог окончательный» по нему ещё нет.
create or replace function public.rnp_buyout_cohort_daily_sku(
  p_from date,
  p_to date,
  p_cabinet uuid,
  p_nm_ids bigint[] default null
)
returns table(
  d date,
  nm_id bigint,
  cohort_orders int,
  cohort_cancelled int,
  cohort_kept int,
  cohort_kept_open int,
  cohort_returned int
)
language sql stable as $$
  with orders as (
    select o.srid, o.nm_id, o.date::date as d, coalesce(o.is_cancel, false) as is_cancel
    from public.wb_orders o
    where o.cabinet_id = p_cabinet
      and (p_nm_ids is null or o.nm_id = any(p_nm_ids))
      and o.date >= p_from::timestamptz
      and o.date < (p_to + 1)::timestamptz
  ),
  -- Продажа и возврат заказа всегда позже самого заказа, поэтому продажи
  -- достаточно читать с начала периода.
  fates as (
    select
      s.srid,
      bool_or(s.sale_id like 'S%') as sold,
      bool_or(s.sale_id like 'R%') as returned,
      min(s.date) filter (where s.sale_id like 'S%') as sold_at
    from public.wb_sales s
    where s.cabinet_id = p_cabinet
      and (p_nm_ids is null or s.nm_id = any(p_nm_ids))
      and s.date >= p_from::timestamptz
      and s.srid is not null
    group by s.srid
  )
  select
    o.d,
    o.nm_id::bigint,
    count(*)::int,
    count(*) filter (where o.is_cancel)::int,
    count(*) filter (where not o.is_cancel and coalesce(f.sold, false) and not coalesce(f.returned, false))::int,
    count(*) filter (
      where not o.is_cancel and coalesce(f.sold, false) and not coalesce(f.returned, false)
        and f.sold_at > now() - interval '21 days'
    )::int,
    count(*) filter (where not o.is_cancel and coalesce(f.returned, false))::int
  from orders o
  left join fates f on f.srid = o.srid
  group by o.d, o.nm_id
$$;

-- С какой даты у продаж кабинета есть srid. Колонка появилась 23.08.2026
-- (202608230009) и назад не заполнялась: у заказа, выкупленного раньше,
-- строка продажи без srid, и когорта не увидела бы выкуп — процент упал бы
-- к нулю. Заказы до этой даты РНП считает «фактом, которого нет».
create or replace function public.rnp_sales_srid_since(p_cabinet uuid)
returns date
language sql stable as $$
  select min(s.date)::date
  from public.wb_sales s
  where s.cabinet_id = p_cabinet
    and s.srid is not null
$$;

create index if not exists wb_sales_cabinet_date_with_srid_idx
  on public.wb_sales (cabinet_id, date)
  where srid is not null;

-- Две ветки вместо «p_nm_ids is null or nm_id = any(p_nm_ids)»: через PostgREST
-- аргументы известны только при выполнении, и OR не становится условием
-- индекса — кабинет с ограниченным ассортиментом читал бы весь финотчёт
-- кабинета за период (финотчёт, в отличие от заказов, при синке по
-- ассортименту не фильтруется). Каждая ветка получает One-Time Filter.
--
-- rr_dt сравнивается без приведения типа, чтобы индекс работал. Если колонка
-- заведена не датой, а текстом, функция не создастся с явной ошибкой — это
-- лучше, чем тихий полный просмотр.
create or replace function public.rnp_report_logistics_daily_sku(
  p_from date,
  p_to date,
  p_cabinet uuid,
  p_nm_ids bigint[] default null
)
returns table(
  d date,
  nm_id bigint,
  logistics_rub numeric,
  sold_units int
)
language sql stable as $$
  select
    r.rr_dt::date,
    r.nm_id::bigint,
    coalesce(sum(coalesce(r.delivery_rub, 0)), 0),
    coalesce(sum(
      case
        when lower(coalesce(nullif(r.doc_type_name, ''), r.supplier_oper_name, '')) like '%продаж%'
          then abs(coalesce(r.quantity, 1))
        when lower(coalesce(nullif(r.doc_type_name, ''), r.supplier_oper_name, '')) like '%возврат%'
          then -abs(coalesce(r.quantity, 1))
        else 0
      end
    ), 0)::int
  from public.wb_report_rows r
  where p_nm_ids is null
    and r.cabinet_id = p_cabinet
    and r.nm_id is not null
    and r.rr_dt >= p_from
    and r.rr_dt <= p_to
  group by r.rr_dt::date, r.nm_id
  union all
  select
    r.rr_dt::date,
    r.nm_id::bigint,
    coalesce(sum(coalesce(r.delivery_rub, 0)), 0),
    coalesce(sum(
      case
        when lower(coalesce(nullif(r.doc_type_name, ''), r.supplier_oper_name, '')) like '%продаж%'
          then abs(coalesce(r.quantity, 1))
        when lower(coalesce(nullif(r.doc_type_name, ''), r.supplier_oper_name, '')) like '%возврат%'
          then -abs(coalesce(r.quantity, 1))
        else 0
      end
    ), 0)::int
  from public.wb_report_rows r
  where p_nm_ids is not null
    and r.cabinet_id = p_cabinet
    and r.nm_id = any(p_nm_ids)
    and r.rr_dt >= p_from
    and r.rr_dt <= p_to
  group by r.rr_dt::date, r.nm_id
$$;

-- Докуда финотчёт кабинета вообще загружен: дни после этой даты — «ещё нет
-- отчёта», а не «логистики не было».
create or replace function public.rnp_report_coverage(p_cabinet uuid)
returns table(first_day date, last_day date)
language sql stable as $$
  select min(r.rr_dt)::date, max(r.rr_dt)::date
  from public.wb_report_rows r
  where r.cabinet_id = p_cabinet
$$;

create index if not exists wb_report_rows_cabinet_rr_dt_idx
  on public.wb_report_rows (cabinet_id, rr_dt);

create index if not exists wb_report_rows_cabinet_nm_rr_dt_idx
  on public.wb_report_rows (cabinet_id, nm_id, rr_dt);
