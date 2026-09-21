-- Суточные остатки по артикулам из снимков wb_stocks_history — для РНП.
--
-- РНП показывал остаток «точкой»: только сегодняшний снимок, а прошлые дни
-- оставались пустыми, чтобы не выдавать сегодняшний остаток за вчерашний.
-- Снимки при этом копятся с 19.07.2026 — раз в четыре часа (03, 07, 11, 15, 19,
-- 23 по Москве), — и ряд по дням из них собирается без догадок.
--
-- Три правила, из-за которых функция устроена именно так:
--
-- 1. СНИМОК НА ФИКСИРОВАННЫЙ ЧАС. Для суток берётся последний успешный снимок не
--    позже p_hour:59 по Москве (по умолчанию 23 — остаток на конец дня). Чтобы дни
--    сравнивались между собой, час один и тот же, а не «какой запуск попался».
--
-- 2. ТОЛЬКО УСПЕШНЫЕ СНИМКИ. Список берётся из журнала крона (sync_log, job
--    stocks-history, статус ok): неудавшийся запуск мог записать часть строк. Тот же
--    журнал отличает нуль от пропуска — снимок пишет только ненулевые пары
--    «артикул — склад», и у артикула без остатка строк нет вовсе. День в списке
--    `covered`, а артикула в нём нет — остаток был нулевой.
--
-- 3. ОСТАТОК — ТОЛЬКО «СКЛАД WB». Реален лишь он (FBW и FBS): склады по городам
--    после пожара пусты, а их строки в отчёте WB — фантом (владелец, 21.09.2026).
--    «В пути к клиенту» и «от клиента» WB не делит по складам, они суммируются по
--    всем строкам артикула.
--
-- Ответ — один jsonb, а не таблица: PostgREST молча режет любой набор строк на
-- тысяче, а «артикулов × дней» легко больше. Форма:
--   { "hour": 23,
--     "covered": ["2026-09-01", ...],                       -- дни со снимком
--     "byNm": { "755558108": { "2026-09-01": [остаток, в пути к, в пути от], ... } } }

create or replace function public.wb_stock_history_daily(
  p_cabinet uuid,
  p_from date,
  p_to date,
  p_hour integer default 23,
  p_nm_ids bigint[] default null
)
returns jsonb
language sql
stable
as $$
  with runs as (
    select (s.started_at at time zone 'Europe/Moscow')::date as day, s.started_at
    from public.sync_log s
    where s.job = 'stocks-history'
      and s.status = 'ok'
      and s.started_at >= ((p_from - 1)::timestamp at time zone 'Europe/Moscow')
      and s.started_at <  ((p_to + 2)::timestamp at time zone 'Europe/Moscow')
      and extract(hour from (s.started_at at time zone 'Europe/Moscow')) <= p_hour
  ),
  picked as (
    select distinct on (r.day) r.day, r.started_at
    from runs r
    where r.day between p_from and p_to
    order by r.day, r.started_at desc
  ),
  per_nm_day as (
    select
      p.day,
      h.nm_id,
      coalesce(sum(h.quantity) filter (where h.warehouse ~* '^склад\s+(wb|вб)'), 0) as stock,
      coalesce(sum(h.in_way_to_client), 0) as in_way_to_client,
      coalesce(sum(h.in_way_from_client), 0) as in_way_from_client
    from picked p
    join public.wb_stocks_history h
      on h.snapshot_at between p.started_at - interval '1 second' and p.started_at + interval '1 second'
    where (p_cabinet is null or h.cabinet_id = p_cabinet)
      and (p_nm_ids is null or h.nm_id = any(p_nm_ids))
    group by p.day, h.nm_id
  ),
  per_nm as (
    select
      nm_id,
      jsonb_object_agg(day::text, jsonb_build_array(stock, in_way_to_client, in_way_from_client)) as days
    from per_nm_day
    group by nm_id
  )
  select jsonb_build_object(
    'hour', p_hour,
    'covered', coalesce((select jsonb_agg(day::text order by day) from picked), '[]'::jsonb),
    'byNm', coalesce((select jsonb_object_agg(nm_id::text, days) from per_nm), '{}'::jsonb)
  )
$$;

-- Ветка `p_cabinet is null or …` при общем плане деградирует (PROJECT-KNOWLEDGE §4).
alter function public.wb_stock_history_daily(uuid, date, date, integer, bigint[])
  set plan_cache_mode = force_custom_plan;

comment on function public.wb_stock_history_daily(uuid, date, date, integer, bigint[]) is
  'Суточные остатки по артикулам из снимков wb_stocks_history: снимок на фиксированный час, только успешные запуски крона, остаток только по «Склад WB».';
