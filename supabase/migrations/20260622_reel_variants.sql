-- «1 генерация → N монтажей» (reuse): трекинг R рендер-вариантов одного рецепта.
-- Отдельная таблица (render_id на строку) → НЕ трогает node_recipes.run_plan и денежный self-chaining graphRun;
-- каждый вариант независим (нет гонки за общий массив рендеров). Роут: /api/factory/reel-recompose. Доступ — service-role.
create table if not exists reel_variants (
  id          bigint generated always as identity primary key,
  recipe_id   bigint not null,
  variant_idx int not null,                       -- индекс варианта в запросе
  hook        text,                                -- хук этого варианта (ось №1 дифференциации)
  render_id   text,                                -- id рендера на Remotion-VM
  status      text not null default 'rendering',   -- rendering | banking | done | error
  video_url   text,                                -- готовый mp4 (после банка)
  props       jsonb,                               -- ReelV5 reel_props этого варианта (воспроизводимость)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists reel_variants_recipe_idx on reel_variants(recipe_id, variant_idx);

notify pgrst, 'reload schema';
