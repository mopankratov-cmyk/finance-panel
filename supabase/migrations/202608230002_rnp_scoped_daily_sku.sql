-- Кабинеты с ограниченным ассортиментом: агрегат вместо сырых строк.
--
-- Замер на проде 23.08.2026 (Оптима, окно 7 дней): по 18 артикулам лежит
-- 10 679 заказов, 10 651 продажа и 12 149 сборочных заданий. Панель тянула
-- их построчно — одиннадцать страниц по тысяче, 4-6 секунд на каждый из трёх
-- источников. Остальные кабинеты этой ветки не используют: у них агрегирует
-- rnp_daily_sku, и наружу едут сотни строк вместо десятков тысяч.
--
-- Функция повторяет ровно ту арифметику, что делал TypeScript, чтобы цифры
-- не поехали:
--   * цена заказа до СПП — price_with_disc, иначе total_price с учётом
--     discount_percent (см. orderPriceBeforeSpp);
--   * отменённый заказ не попадает в поток заказов, но считается отдельно;
--   * выкупы — только строки sale_id, начинающиеся на 'S';
--   * схема FBS/FBW определяется наличием srid в сборочных заданиях и только
--     до границы достоверности p_fbs_cutoff: свежее задание могло не доехать,
--     и «не-FBS» там не доказан. NULL-граница = не классифицируем вовсе.
create or replace function public.rnp_scoped_daily_sku(
  p_from date,
  p_to date,
  p_cabinet uuid,
  p_nm_ids bigint[],
  p_fbs_cutoff date default null
)
returns table(
  d date,
  nm_id bigint,
  article text,
  orders_count int,
  orders_sum numeric,
  orders_gross_sum numeric,
  cancels_count int,
  cancels_sum numeric,
  orders_fbs_count int,
  orders_fbs_sum numeric,
  orders_fbw_count int,
  orders_fbw_sum numeric,
  buyouts_count int,
  buyouts_sum numeric,
  buyouts_gross_sum numeric,
  buyouts_finished_sum numeric,
  ad_spent numeric
)
language sql stable as $$
  with fbs as (
    select distinct srid
    from public.wb_fbs_orders
    where cabinet_id = p_cabinet
      and nm_id = any(p_nm_ids)
      and created_at_wb >= p_from::timestamptz
      and created_at_wb < (p_to + 1)::timestamptz
  ),
  orders as (
    select
      o.date::date as d,
      o.nm_id,
      max(o.supplier_article) as article,
      count(*) filter (where coalesce(o.is_cancel, false) = false)::int as oc,
      coalesce(sum(
        case when coalesce(o.is_cancel, false) = false
          then coalesce(o.price_with_disc, coalesce(o.total_price, 0) * (1 - coalesce(o.discount_percent, 0) / 100.0))
        end), 0) as os,
      coalesce(sum(
        case when coalesce(o.is_cancel, false) = false
          then coalesce(o.total_price, o.price_with_disc, 0)
        end), 0) as ogs,
      count(*) filter (where coalesce(o.is_cancel, false) = true)::int as cc,
      coalesce(sum(
        case when coalesce(o.is_cancel, false) = true
          then coalesce(o.price_with_disc, coalesce(o.total_price, 0) * (1 - coalesce(o.discount_percent, 0) / 100.0))
        end), 0) as cs,
      -- Схема считается только до границы достоверности сборочных заданий.
      count(*) filter (
        where coalesce(o.is_cancel, false) = false
          and p_fbs_cutoff is not null and o.date::date <= p_fbs_cutoff
          and o.srid in (select srid from fbs)
      )::int as fbs_c,
      coalesce(sum(
        case when coalesce(o.is_cancel, false) = false
          and p_fbs_cutoff is not null and o.date::date <= p_fbs_cutoff
          and o.srid in (select srid from fbs)
          then coalesce(o.price_with_disc, coalesce(o.total_price, 0) * (1 - coalesce(o.discount_percent, 0) / 100.0))
        end), 0) as fbs_s,
      count(*) filter (
        where coalesce(o.is_cancel, false) = false
          and p_fbs_cutoff is not null and o.date::date <= p_fbs_cutoff
          and o.srid not in (select srid from fbs)
      )::int as fbw_c,
      coalesce(sum(
        case when coalesce(o.is_cancel, false) = false
          and p_fbs_cutoff is not null and o.date::date <= p_fbs_cutoff
          and o.srid not in (select srid from fbs)
          then coalesce(o.price_with_disc, coalesce(o.total_price, 0) * (1 - coalesce(o.discount_percent, 0) / 100.0))
        end), 0) as fbw_s
    from public.wb_orders o
    where o.cabinet_id = p_cabinet
      and o.nm_id = any(p_nm_ids)
      and o.date >= p_from::timestamptz
      and o.date < (p_to + 1)::timestamptz
    group by 1, 2
  ),
  sales as (
    select
      s.date::date as d,
      s.nm_id,
      count(*)::int as bc,
      coalesce(sum(coalesce(s.price_with_disc, s.finished_price, 0)), 0) as bs,
      coalesce(sum(coalesce(s.finished_price, s.price_with_disc, 0)), 0) as bfs
    from public.wb_sales s
    where s.cabinet_id = p_cabinet
      and s.nm_id = any(p_nm_ids)
      and s.date >= p_from::timestamptz
      and s.date < (p_to + 1)::timestamptz
      and s.sale_id like 'S%'
    group by 1, 2
  ),
  ads as (
    select a.date as d, a.nm_id, coalesce(sum(coalesce(a.spent, 0)), 0) as ad
    from public.wb_advert_nm_daily a
    where a.cabinet_id = p_cabinet
      and a.nm_id = any(p_nm_ids)
      and a.date between p_from and p_to
    group by 1, 2
  ),
  keys as (
    select d, nm_id from orders
    union select d, nm_id from sales
    union select d, nm_id from ads
  )
  select
    k.d,
    k.nm_id::bigint,
    o.article,
    coalesce(o.oc, 0), coalesce(o.os, 0), coalesce(o.ogs, 0),
    coalesce(o.cc, 0), coalesce(o.cs, 0),
    coalesce(o.fbs_c, 0), coalesce(o.fbs_s, 0),
    coalesce(o.fbw_c, 0), coalesce(o.fbw_s, 0),
    coalesce(s.bc, 0), coalesce(s.bs, 0), coalesce(s.bs, 0), coalesce(s.bfs, 0),
    coalesce(a.ad, 0)
  from keys k
  left join orders o on o.d = k.d and o.nm_id = k.nm_id
  left join sales s on s.d = k.d and s.nm_id = k.nm_id
  left join ads a on a.d = k.d and a.nm_id = k.nm_id;
$$;

alter function public.rnp_scoped_daily_sku(date, date, uuid, bigint[], date)
  set plan_cache_mode = force_custom_plan;
