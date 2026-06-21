-- V3 нод-студия: граф-рецепты, ноды (ключ обучения), шаблоны, журнал сигналов, метрики постинга.
-- §5 ТЗ docs/factory-v3-tz.md. Идемпотентно (create if not exists). Применять в Supabase SQL Editor.
-- Надстраивается над content_assets (теги 20260621) + корпусом (20260620). Ключ ниши — nicheFromArticle (НЕ бренд).

-- ── Граф-голова: рецепт сборки (один граф = одно видео/карусель/пост) ──────────────────────
create table if not exists node_recipes (
  id                   bigint generated always as identity primary key,
  article              text,
  niche                text,                              -- nicheFromArticle (единый ключ)
  mode                 text,                              -- audience | sell
  format_detected      text,                              -- ugc_anim|ai_render|prank|talking_head|before_after|pov|carousel|static
  source_viral_video_id bigint references viral_videos(id) on delete set null, -- если перенесён из корпуса
  parent_graph_id      bigint references node_recipes(id) on delete set null,  -- форк/версия (A/B)
  built_by             text not null default 'manual',    -- manual | assisted | auto
  graph_doc            jsonb,                             -- UI-снимок графа (позиции/цвета/превью/статусы)
  run_plan             jsonb,                             -- плоская мапа node_id→{tool,prompt,params,deps} для очереди
  otk_verdict          jsonb,                             -- 5 осей + verdict + issues[] + fixes[] (ВКЛЮЧАЯ фейлы<8)
  otk_score            numeric,
  render_id            text,                              -- id рендера Shotstack
  output_url           text,                              -- финальный mp4 (после save → Storage)
  status               text not null default 'draft',     -- draft|otk_pass|otk_fail|posted
  recipe_confidence    int not null default 1,            -- 1-5
  created_by           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists node_recipes_niche_idx   on node_recipes(niche, recipe_confidence desc, otk_score desc);
create index if not exists node_recipes_builtby_idx  on node_recipes(built_by);
create index if not exists node_recipes_status_idx   on node_recipes(status);
create index if not exists node_recipes_article_idx  on node_recipes(article);

-- ── Строка-на-ноду — КЛЮЧЕВАЯ для обучения (retrieval по niche/slot/tool) ───────────────────
create table if not exists node_recipe_nodes (
  id               bigint generated always as identity primary key,
  recipe_id        bigint not null references node_recipes(id) on delete cascade,
  ordinal          int not null default 0,
  slot             text,                                  -- hook|scene|payoff|transition|caption|music|effect|loop
  node_type        text,                                  -- hook_ugc|ai_product_render|talking_head|... (см. §4)
  tool             text,                                  -- seedance|kling|creatify|higgsfield|gemini|shotstack|sharp|disk_real|sound
  prompt           text,
  params           jsonb,                                 -- ВСЕ API-настройки инструмента (тело API)
  asset_id         bigint references content_assets(id) on delete set null,
  asset_url        text,
  duration_sec     numeric,
  source           text not null default 'human_chosen',  -- human_chosen|agent_suggested|transferred_from_corpus
  human_edited     boolean not null default false,
  agent_suggestion jsonb,                                 -- что агент предлагал ДО правки человека — золото обучения
  created_at       timestamptz not null default now()
);
create index if not exists node_recipe_nodes_recipe_idx on node_recipe_nodes(recipe_id, ordinal);
create index if not exists node_recipe_nodes_learn_idx  on node_recipe_nodes(slot, tool) where human_edited = false;

-- ── Шаблоны из анализа конкурентов (каркасы для «перенести себе») ───────────────────────────
create table if not exists node_templates (
  id              bigint generated always as identity primary key,
  source_video_url text,
  source_viral_video_id bigint references viral_videos(id) on delete set null,
  format_type     text,
  niche           text,
  nodes           jsonb not null default '[]',            -- типизированные ноды (выход decompose)
  confidence      text,                                   -- high|med|low
  created_at      timestamptz not null default now()
);
create index if not exists node_templates_niche_idx on node_templates(niche, format_type);

-- ── Центральный дата-стек: журнал на КАЖДОЕ событие (включая фейлы<8 — сейчас испаряются) ────
create table if not exists cf_signals (
  id          bigint generated always as identity primary key,
  event       text not null,                              -- generated|approved|rejected|published|metrics
  recipe_id   bigint references node_recipes(id) on delete set null,
  node_id     bigint references node_recipe_nodes(id) on delete set null,
  slot        text,
  tool        text,
  params      jsonb,
  niche       text,
  article     text,
  mode        text,
  axes        jsonb,                                      -- 5 осей ОТК
  engine      text,
  format      text,
  sound_id    text,
  reason_chip text,                                       -- причина «не то»
  created_at  timestamptz not null default now()
);
create index if not exists cf_signals_niche_idx on cf_signals(niche, event, created_at desc);
create index if not exists cf_signals_tool_idx  on cf_signals(slot, tool);

-- ── Контур постинга (СХЕМА-задел; UI/ввод — позже, после реального контента) ─────────────────
create table if not exists post_metrics (
  id          bigint generated always as identity primary key,
  recipe_id   bigint references node_recipes(id) on delete cascade,
  platform    text,
  posted_at   timestamptz,
  views       bigint,
  watch_rate  numeric,
  ctr_card    numeric,
  saves       bigint,
  created_at  timestamptz not null default now()
);
create index if not exists post_metrics_recipe_idx on post_metrics(recipe_id);
