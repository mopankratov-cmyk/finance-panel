-- «Разработка ассортимента», этап 1.3: поля задания на образец (ТЗ §8).
--
-- Экспорт для фабрики должен содержать предлагаемые отличия собственной
-- модели, вопросы к образцу, соответствие сезону и аудитории и ответственного.
-- В схеме этапа 1.1 для них места не было. Без этой миграции подборки
-- работают, но в задании остаются только идея, детали и следующий шаг.
--
-- Цен, валют и любой экономики здесь нет и не будет (граница ТЗ).

alter table public.assortment_collection_items
  add column if not exists brief jsonb not null default '{}'::jsonb;

comment on column public.assortment_collection_items.brief is
  'Задание по кандидату: differences — отличия нашей модели (идея разработки), questions — вопросы к образцу, season_fit — сезон и аудитория. Без цен.';

alter table public.assortment_collections
  add column if not exists responsible text;

comment on column public.assortment_collections.responsible is
  'Ответственный за подборку и задание на образец (имя или почта).';
