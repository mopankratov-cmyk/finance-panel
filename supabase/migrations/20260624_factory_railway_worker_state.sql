-- Railway worker state: живой heartbeat + текущая задача для Studio.
-- Идемпотентно. Применять в Supabase SQL Editor.

create table if not exists railway_worker_states (
  worker_id           text primary key,
  label               text,
  status              text not null default 'idle',      -- idle|working|blocked|pr_open|done|error
  branch              text,
  pr                  text,
  current_task_id     text,
  current_task_title  text,
  progress            text,
  blocker             text,
  note                text,
  queue               jsonb not null default '[]',       -- текущая очередь/снимок статусов
  last_seen           timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists railway_worker_states_last_seen_idx on railway_worker_states(last_seen desc);
create index if not exists railway_worker_states_status_idx on railway_worker_states(status);
