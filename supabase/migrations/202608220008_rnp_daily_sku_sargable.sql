-- РНП: rnp_daily_sku перестаёт сканировать всю историю кабинета.
--
-- Замер на проде 22.08.2026 (СЛОЁНО, окно 7 дней): base_facts_rpc 9 830 мс
-- при общем лимите statement timeout — отсюда плавающие 500 «canceling
-- statement due to statement timeout» на СЛОЁНО и CLERIN, и 9 секунд на
-- CLERIN с Оптимой.
--
-- Причина: предикат `date::date between p_from and p_to`. Приведение КОЛОНКИ
-- к date отключает индексы по (cabinet_id, date, nm_id) — Postgres не умеет
-- искать по btree для выражения над колонкой и читает всю таблицу.
--
-- Индексом это не лечится: у wb_orders и wb_sales колонка date имеет тип
-- timestamptz, а приведение timestamptz→date зависит от таймзоны сессии и не
-- IMMUTABLE, поэтому выражение-индекс Postgres создать не даёт (42P17 —
-- ровно на этом сорвалась попытка 22.08).
--
-- Лечение — предикаты, которые ложатся на существующие индексы:
--   timestamptz-колонки → полуинтервал [p_from, p_to + 1);
--   date-колонки (wb_funnel_daily, wb_advert_nm_daily) → сравнение как есть.
-- Семантика сохранена: обе формы отбирают те же сутки при UTC-сессии, а
-- date::date остаётся в SELECT, где он и нужен — для номера дня.
--
-- force_custom_plan: у функции есть ветка `p_cabinet is null or cabinet_id =
-- p_cabinet`. С общим планом Postgres выбирает seq scan «на все случаи»;
-- пересборка плана под конкретный аргумент возвращает indexscan.

create or replace function public.rnp_daily_sku(p_from date, p_to date, p_cabinet uuid default null)
returns table(d date, nm_id bigint, orders_count int, orders_sum numeric, buyouts_count int, buyouts_sum numeric, ad_spent numeric)
language sql stable as $$
  with order_events as (
    select date::date d, nm_id,
      count(*)::int oc,
      sum(coalesce(price_with_disc, coalesce(total_price, 0) * (1 - coalesce(discount_percent, 0) / 100.0), 0)) os
    from public.wb_orders
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

alter function public.rnp_daily_sku(date, date, uuid) set plan_cache_mode = force_custom_plan;
