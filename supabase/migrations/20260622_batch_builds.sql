-- V21.2 · Полная автономность автопилота: async-очередь СБОРКИ черновиков из конкурентов.
-- «запустил → ушёл → 100 видео» с нуля: батч сам берёт топ-виральные (viral_videos) × товары
-- (product_costs) → пары → self-chain (1 пара/тик: decompose→transfer→черновик-рецепт) → потом /batch
-- (autofill→генерация→ОТК→банк→Telegram). Декомпозиция ×N не влезает в один запрос → очередь как graph-run.
create table if not exists batch_builds (
  id               bigint generated always as identity primary key,
  niche            text,
  pairs            jsonb not null default '[]',   -- worklist [{viral_video_id, article}]
  cursor           int not null default 0,        -- сколько пар обработано
  built_recipe_ids jsonb not null default '[]',   -- созданные черновики
  budget_usd       numeric default 40,            -- бюджет генерации (передаётся в /batch в конце)
  status           text not null default 'building', -- building | running | done | failed
  lease_until      timestamptz,                   -- лиз self-chain (как graph-run)
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists batch_builds_status_idx on batch_builds(status, updated_at desc);

notify pgrst, 'reload schema';
