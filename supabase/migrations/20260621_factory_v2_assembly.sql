-- Factory v2 (модульная сборка): слой тегирования ассетов для Assembly Agent + хранилище рецептов сборки.
-- Расширяет content_assets (из 20260619_content_catalog.sql). Движок монтажа — Shotstack (managed render-API).
-- Применять в Supabase SQL Editor (как 20260620). Инертно без кода/ключа.

-- ── Теги блоков: чтобы Assembly Agent мог выбрать ассет по роли/эмоции/длительности ──
alter table content_assets
  add column if not exists asset_type   text,                       -- real | ai | utility (хребет vs акцент vs служебка)
  add column if not exists role         text,                       -- hook | scene | payoff | transition | text | broll
  add column if not exists emotion      text,                       -- shock | curiosity | calm | flex
  add column if not exists duration_sec numeric,                    -- длительность клипа (для раскладки по секундам/битам)
  add column if not exists beat_suitable boolean not null default false, -- годится ли под нарезку по битам
  add column if not exists tags         text[] not null default '{}';

create index if not exists content_assets_role_idx       on content_assets(role);
create index if not exists content_assets_asset_type_idx on content_assets(asset_type);
-- быстрый подбор блоков под сборку (ниша + роль + тип, только с готовым url)
create index if not exists content_assets_v2_pick_idx    on content_assets(niche, role, asset_type) where url is not null;

-- ── Рецепты сборок (LEGO-комбинации): воспроизводимость вариаций (P1.2) + обучение на КОМБИНАЦИЯХ (P2 winners) ──
create table if not exists factory_assemblies (
  id          bigint generated always as identity primary key,
  article     text,
  niche       text,
  hook        text,
  mode        text,                                                 -- audience | sell
  edit_json   jsonb not null,                                       -- Shotstack Edit timeline целиком (воспроизводимо)
  block_ids   bigint[] not null default '{}',                       -- какие content_assets вошли (аналитика комбо)
  sound_id    text,                                                 -- Virlo трек, под который синканы биты
  beat_times  numeric[] not null default '{}',                      -- сетка битов сборки (фикс-сетка до live-mp3)
  render_id   text,                                                 -- id рендера Shotstack
  output_url  text,                                                 -- финальный mp4 (после save → Supabase Storage)
  otk_score   numeric,
  created_at  timestamptz not null default now()
);
create index if not exists factory_assemblies_niche_idx on factory_assemblies(niche, otk_score desc);
create index if not exists factory_assemblies_article_idx on factory_assemblies(article);

-- Примечание: gen-save уже пишет финал в content_assets(disk='gen'); factory_assemblies хранит РЕЦЕПТ
-- (edit_json + block_ids + beat_times) — для повторения вариаций и петли winners на комбинациях блоков.
