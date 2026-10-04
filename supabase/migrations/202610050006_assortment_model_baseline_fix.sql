-- Исправления по независимому предвыкладочному аудиту миграции 202610050002.
-- Воспроизведено на настоящем Postgres; применённую 002 не правим — только перекрываем.
--
-- 1) «База ли модель». В 002 стояло bool_or(baseline): модель — база, если база
--    ХОТЬ ОДНА её расцветка. Но обход пишет первую расцветку новой модели с
--    baseline=false, а остальные расцветки той же НОВОЙ модели — с baseline=true
--    (новая расцветка известной модели — не новинка). Из-за bool_or вся новая
--    модель с двумя и более расцветками становилась «базой» и никогда не попадала
--    в «Новинки» и в счётчик new_7d. Правильно наоборот: модель — база, только если
--    ВСЕ её расцветки базовые (bool_and). Старая модель с новой расцветкой по-прежнему
--    не новинка: дата первого появления берётся по самой ранней расцветке.
--
-- 2) Фото головы модели. Голова — связанная с находкой расцветка; если у неё нет
--    фото, а у соседней расцветки есть, карточка оставалась без картинки и не
--    попадала в разбор по фото, хотя счётчик with_photo модель «с фото» считал.
--    Теперь, если у головы фото нет, берётся фото самой свежей расцветки модели,
--    у которой оно есть. Порядок выбора головы не меняется.
--
-- 3) H&M (S007). Обратное заполнение 002 склеило строки H&M по названию, а код
--    после ревью их не склеивает (названия у H&M общие, «Padded jacket» у разных
--    артикулов): ключ источника — source|source_item_id. Приводим ключи к виду,
--    который считает код. Идемпотентно.
--
-- Колонки видов те же, что были (create or replace). Новых таблиц нет.

update public.assortment_source_items
set model_key = source_id || '|' || source_item_id
where source_id = 'S007'
  and model_key is distinct from source_id || '|' || source_item_id;

create or replace view public.assortment_catalog_stats
with (security_invoker = true) as
with g as (
  select
    source_id,
    direction,
    coalesce(model_key, source_id || '|' || source_item_id) as k,
    bool_or(hidden_at is not null)  as hidden,
    max(last_seen_at)               as last_seen,
    bool_or(image_urls is not null) as has_photo,
    min(first_seen_at)              as first_seen,
    bool_and(baseline)              as baseline
  from public.assortment_source_items
  where direction is not null
  group by 1, 2, 3
)
select
  source_id,
  direction,
  (count(*) filter (where not hidden and last_seen >= now() - interval '30 days'))::int                          as models,
  (count(*) filter (where not hidden and last_seen >= now() - interval '30 days' and has_photo))::int            as with_photo,
  (count(*) filter (where not hidden and not baseline and first_seen >= now() - interval '7 days'))::int         as new_7d,
  (count(*) filter (where hidden))::int                                                                          as hidden,
  max(last_seen)                                                                                                 as last_seen_at
from g
group by source_id, direction;

revoke all on public.assortment_catalog_stats from anon, authenticated;

create or replace view public.assortment_catalog_heads
with (security_invoker = true) as
select t.*
from (
  select
    i.source_id, i.source_item_id, i.handle, i.title, i.product_type, i.direction,
    i.published_at, i.baseline, i.reference_id, i.first_seen_at, i.last_seen_at,
    -- Фото головы; нет — фото самой свежей расцветки модели, у которой оно есть.
    coalesce(i.image_urls, first_value(i.image_urls) over wp) as image_urls,
    i.brand, i.badges, i.hidden_at, i.model_key,
    count(*) filter (where i.last_seen_at >= now() - interval '30 days') over w as variants,
    min(i.first_seen_at)  over w as model_first_seen_at,
    bool_and(i.baseline)  over w as model_baseline,
    min(i.hidden_at)      over w as model_hidden_at,
    max(i.last_seen_at)   over w as model_last_seen_at,
    row_number() over (
      w order by
        (i.reference_id is null),
        (i.last_seen_at < now() - interval '30 days'),
        (i.image_urls is null),
        i.last_seen_at desc,
        i.source_item_id
    ) as rn
  from public.assortment_source_items i
  where i.direction is not null
  window
    w as (partition by i.source_id, i.direction, coalesce(i.model_key, i.source_id || '|' || i.source_item_id)),
    wp as (
      partition by i.source_id, i.direction, coalesce(i.model_key, i.source_id || '|' || i.source_item_id)
      order by (i.image_urls is null), i.last_seen_at desc, i.source_item_id
      rows between unbounded preceding and unbounded following
    )
) t
where t.rn = 1;

revoke all on public.assortment_catalog_heads from anon, authenticated;

notify pgrst, 'reload schema';
