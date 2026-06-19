-- Каталог реального контента со съёмок (Яндекс.Диски), упорядоченный по нише и артикулу,
-- + визуальные профили ниш для «обучения» агентов завода (референсный грудинг, не веса).

create table if not exists content_assets (
  id          bigint generated always as identity primary key,
  disk        text not null,                       -- norvia | design
  path        text not null,                       -- путь на Яндекс.Диске
  name        text not null,
  kind        text not null check (kind in ('image','video')),
  niche       text,                                -- jackets | bags | blasters | cream | ...
  article     text,                                -- best-effort привязка к артикулу
  color       text,                                -- вариант (из имени подпапки)
  url         text,                                -- прокси-URL (для image; FAL фетчит напрямую)
  analyzed    boolean not null default false,
  analysis    jsonb,                               -- визуальный разбор кадра
  created_at  timestamptz not null default now(),
  unique (disk, path)
);
create index if not exists content_assets_niche_idx   on content_assets(niche);
create index if not exists content_assets_article_idx on content_assets(article);

-- «Визуальный рецепт» ниши: усреднённый стиль наших удачных съёмок. Этим грундятся агенты.
create table if not exists niche_visual_profiles (
  niche        text primary key,
  profile      jsonb not null,                     -- {framing,camera,lighting,model_action,palette,props,mood,do[],dont[],refs[]}
  sample_count int not null default 0,
  updated_at   timestamptz not null default now()
);
