-- «Разработка ассортимента», движок тенденций — этап 1: каталог считает модели,
-- а не строки.
--
-- У части источников строка каталога — это ЦВЕТ модели: Shopify-бренды (JW PEI,
-- Polène, Songmont, Rains) кладут каждую расцветку отдельным товаром, ASOS и
-- H&M — отдельной карточкой на цвет. На 04.10 у JW PEI 1 225 строк при ~590
-- моделях, у Polène 287 при 35: счётчик «моделей» и любая доля формы были
-- перекошены одним брендом.
--
-- Что делает миграция:
--  1) model_key — ключ модели: расцветки одной модели получают один ключ. Код
--     (lib/assortment/modelKey.ts) пишет его при каждом обходе; здесь — разовое
--     обратное заполнение теми же правилами, чтобы эффект был сразу.
--  2) assortment_catalog_stats — счётчики теперь по моделям.
--  3) assortment_catalog_heads — по одной «голове» на модель (для списка каталога):
--     дата и «новинка» считаются по САМОЙ РАННЕЙ расцветке, поэтому новый цвет
--     старой модели новинкой не становится (форму не путаем с цветом).
--
-- Источники, где номер строки уже модельный (Zara, Uniqlo, сайты РФ), по названию
-- НЕ склеиваются: у сайтов РФ названия общие («куртка женская»), склейка слила бы
-- разные вещи. Цен нет и не будет (граница модуля).
--
-- Колонки каталога из PR #1447 (202610040001) добавлены здесь же через
-- «if not exists»: на проде они уже есть (пустая операция), а чистое окружение
-- из main без них не соберёт виды.

alter table public.assortment_source_items
  add column if not exists image_urls text[],
  add column if not exists brand      text,
  add column if not exists badges     text[],
  add column if not exists hidden_at  timestamptz,
  add column if not exists model_key  text;

create index if not exists assortment_source_items_model_idx
  on public.assortment_source_items (source_id, direction, model_key);

-- Обратное заполнение. Те же правила, что у constructionHead/modelKey в коде:
-- нижний регистр, ё→е, голова названия до « - Цвет» / « | » / запятой, срез
-- «in <цвет>» (если останется хотя бы три слова). Источники «цвет = строка»:
-- S014 Rains, S024 Polène, S026 Songmont, S027 JW PEI, S046 ASOS. H&M (S007) не склеивается: у него общие названия (исправлено 202610050006).
-- Повторный запуск безопасен (меняет только отличающиеся строки); следующие
-- обходы перепишут ключ кодом.
update public.assortment_source_items i
set model_key = k.key
from (
  select c.source_id, c.source_item_id,
    case
      when c.source_id in ('S014','S024','S026','S027','S046') and length(c.head) >= 3
        then c.source_id || '|' || c.head
      else c.source_id || '|' || c.source_item_id
    end as key
  from (
    select b.source_id, b.source_item_id,
      case
        when b.m is not null and array_length(regexp_split_to_array(b.m[1], '\s+'), 1) >= 3 then b.m[1]
        else b.base
      end as head
    from (
      select a.source_id, a.source_item_id, a.base,
        regexp_match(a.base, '^(.*\S)\s+in\s+[[:alnum:]''&/-]+(?:\s+[[:alnum:]''&/-]+){0,2}$') as m
      from (
        select s.source_id, s.source_item_id,
          btrim(regexp_replace(
            (regexp_split_to_array(replace(lower(coalesce(s.title, '')), 'ё', 'е'), '\s+[-–—|]\s+|,\s+'))[1],
            '\s+', ' ', 'g')) as base
        from public.assortment_source_items s
      ) a
    ) b
  ) c
) k
where i.source_id = k.source_id
  and i.source_item_id = k.source_item_id
  and i.model_key is distinct from k.key;

-- Счётчики вкладки, чипов брендов и экрана «Источники»: строка на источник и
-- раздел, считаем МОДЕЛИ. Колонки те же, что были (код их уже читает).
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
    bool_or(baseline)               as baseline
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

-- Каталог брендов: по одной «голове» на модель. Голова — расцветка, которую
-- показываем: сначала связанная с находкой, затем с фото, затем свежая. Всё про
-- модель (первое появление, «база», скрытие, последний показ, число расцветок)
-- считается по всем её расцветкам: скрыли один цвет — скрыта модель, новый цвет
-- старой модели — не новинка.
create or replace view public.assortment_catalog_heads
with (security_invoker = true) as
select t.*
from (
  select
    i.source_id, i.source_item_id, i.handle, i.title, i.product_type, i.direction,
    i.published_at, i.baseline, i.reference_id, i.first_seen_at, i.last_seen_at,
    i.image_urls, i.brand, i.badges, i.hidden_at, i.model_key,
    count(*) filter (where i.last_seen_at >= now() - interval '30 days') over w as variants,
    min(i.first_seen_at)  over w as model_first_seen_at,
    bool_or(i.baseline)   over w as model_baseline,
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
  window w as (partition by i.source_id, i.direction, coalesce(i.model_key, i.source_id || '|' || i.source_item_id))
) t
where t.rn = 1;

revoke all on public.assortment_catalog_heads from anon, authenticated;

notify pgrst, 'reload schema';

-- Проверка после применения (отдельно, в боевом проекте xyzbkecwshlfltbralhm):
-- select count(*) filter (where model_key is null) as без_ключа from public.assortment_source_items;   -- 0
-- select source_id, direction, models, with_photo, new_7d from public.assortment_catalog_stats order by models desc;
--   ожидание на 04.10: S027 ≈ 590 моделей (было 1225 строк), S024 ≈ 35 (было 287), S026 ≈ 57 (было 180).
-- select count(*) from public.assortment_catalog_heads;   -- моделей в каталоге (меньше числа строк)
