-- Стор статуса рендер-джоб для render-service (render-service/server.mjs).
-- Зачем: очередь джоб живёт in-memory в процессе воркера, а контракт submit→poll опрашивает /status/:id.
-- Чтобы лить ФЛОТ воркеров за балансировщиком, /status должен отвечать с ЛЮБОЙ инстанс → выносим статус сюда.
-- Рендер по-прежнему идёт на той инстанс, что приняла /render; сюда пишется только статус/прогресс/результат.
-- Таблицы нет → сервис тихо работает только in-memory (одиночная ВМ, как раньше). Доступ — service-role (RLS не нужен).
create table if not exists render_jobs (
  id          text primary key,                    -- id джобы из server.mjs (base36-время + seq)
  status      text not null default 'in_progress', -- in_progress | done | error
  progress    int  not null default 0,             -- 0..100
  video_url   text,                                 -- готовый mp4 (Supabase Storage)
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists render_jobs_created_at_idx on render_jobs(created_at);

notify pgrst, 'reload schema';
