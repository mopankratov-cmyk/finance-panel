-- V3 кэш превью нод: одна и та же нода (tool+prompt+params+вход) → один и тот же клип → не платим дважды.
-- §6 ТЗ: «превью ноды с хэш-кэшем». Идемпотентно. Применять в Supabase SQL Editor.
-- Эндпоинт деградирует мягко, если таблица не применена (try/catch вокруг кэша).

create table if not exists node_previews (
  id           bigint generated always as identity primary key,
  hash         text not null,                       -- nodeHash(tool+prompt+params+вход) — ключ кэша
  tool         text,
  engine       text,                                -- fal|creatify|disk|asset
  node_type    text,
  recipe_id    bigint references node_recipes(id) on delete set null,
  node_id      bigint references node_recipe_nodes(id) on delete set null,
  token        text,                                -- токен опроса (engine::inner), пока in_progress
  status       text not null default 'in_progress', -- in_progress|done|error
  output_url   text,                                -- готовый mp4/картинка
  error        text,
  cost_hint    text,                                -- free|low|med|high
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- быстрый кэш-хит по свежему готовому превью
create unique index if not exists node_previews_hash_uidx on node_previews(hash);
create index if not exists node_previews_recipe_idx on node_previews(recipe_id);
