-- V20 · Память итераций: КАЖДАЯ попытка генерации (вкл. тестовые/провальные/варианты) с lineage.
-- Закрывает «тесты не попадают в базу — нет памяти что менялось/исправлялось»:
--   gen-save дедупит по source_url, node_previews кэш-перезапись по hash, standalone мимо БД.
-- Эта таблица НЕ дедупит — пишет историю. Субстрат под петлю обучения (R6/V7).
-- Идемпотентно. Применять в Supabase SQL Editor. Эндпоинты деградируют мягко, если не применена (try/catch).

create table if not exists generation_history (
  id           bigint generated always as identity primary key,
  parent_id    bigint references generation_history(id) on delete set null, -- от какой версии (итерация/реген/A-B)
  recipe_id    bigint references node_recipes(id) on delete set null,
  node_id      bigint references node_recipe_nodes(id) on delete set null,
  variant_idx  int,                                  -- какой из N вариантов на ТЗ (R4), null = единственный
  attempt      int not null default 1,               -- номер попытки реген-петли (V3/V4)
  tool         text,
  engine       text,                                 -- fal|creatify|shotstack|remotion|disk|elevenlabs
  node_type    text,
  prompt       text,                                 -- снапшот промпта на момент попытки
  params       jsonb,                                -- снапшот params ноды
  input_url    text,                                 -- вход (фото/исходник)
  output_url   text,                                 -- результат (клип/видео/аудио)
  otk_score    numeric,
  otk_axes     jsonb,                                -- 5 осей ОТК
  otk_verdict  text,
  artifact_ok  boolean,                              -- прошёл артефакт-гейт (R3)
  status       text not null default 'generated',    -- generated|artifact_fail|otk_pass|otk_fail|regen|approved|rejected
  source       text not null default 'studio',       -- studio|graph_run|batch|node_preview|standalone|test
  cost_hint    text,                                 -- free|low|med|high
  reason       text,                                 -- причина реджекта/реген / заметка
  niche        text,
  article      text,
  created_at   timestamptz not null default now()
);
create index if not exists gen_history_recipe_idx  on generation_history(recipe_id);
create index if not exists gen_history_parent_idx  on generation_history(parent_id);
create index if not exists gen_history_node_idx    on generation_history(node_id);
create index if not exists gen_history_created_idx on generation_history(created_at desc);
create index if not exists gen_history_source_idx  on generation_history(source);

-- PostgREST после CREATE: Settings→API→Reload schema ИЛИ:
notify pgrst, 'reload schema';
