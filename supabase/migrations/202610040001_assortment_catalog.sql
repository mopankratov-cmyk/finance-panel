-- «Разработка ассортимента»: каталог брендов поверх базы обхода.
--
-- Первый обход каждого источника кладёт весь каталог в assortment_source_items
-- базой сравнения (в «Новинки» он не идёт — так задумано). Ссылки на фото,
-- бренд и метки сайта при этом выбрасывались, и тысячи собранных моделей были
-- невидимы в панели (жалоба владельца 04.10: «там мало товаров»). Храним только
-- ССЫЛКИ на фото с сайта бренда (файлы не копируем; копия в закрытое хранилище —
-- только у модели, которую человек отобрал), бренд и метки «новинка/бестселлер».
-- hidden_at — «не интересно» в каталоге: модель уходит из выдачи, но остаётся в
-- базе сравнения. Цен здесь нет и не будет (граница ТЗ v3).

alter table public.assortment_source_items
  add column if not exists image_urls text[],
  add column if not exists brand      text,
  add column if not exists badges     text[],
  add column if not exists hidden_at  timestamptz;

-- Экран каталога: раздел, свежие сверху, устойчивый порядок для «Показать ещё».
create index if not exists assortment_source_items_catalog_idx
  on public.assortment_source_items (direction, first_seen_at desc, source_id, source_item_id)
  where direction is not null;

-- Счётчики вкладки, чипов брендов и экрана «Источники»: строка на источник и раздел.
-- Код пишет image_urls только непустым массивом, поэтому «is not null» = «есть фото».
create or replace view public.assortment_catalog_stats
with (security_invoker = true) as
select
  source_id,
  direction,
  count(*) filter (where hidden_at is null and last_seen_at >= now() - interval '30 days')::int as models,
  count(*) filter (where hidden_at is null and last_seen_at >= now() - interval '30 days' and image_urls is not null)::int as with_photo,
  count(*) filter (where hidden_at is null and baseline = false and first_seen_at >= now() - interval '7 days')::int as new_7d,
  count(*) filter (where hidden_at is not null)::int as hidden,
  max(last_seen_at) as last_seen_at
from public.assortment_source_items
where direction is not null
group by source_id, direction;

revoke all on public.assortment_catalog_stats from anon, authenticated;

notify pgrst, 'reload schema';

-- Проверка после применения (отдельно, в боевом проекте xyzbkecwshlfltbralhm):
-- select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'assortment_source_items'
--     and column_name in ('image_urls','brand','badges','hidden_at');   -- 4 строки
-- select * from public.assortment_catalog_stats order by models desc limit 20;
