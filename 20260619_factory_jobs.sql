-- Серверная очередь генераций контент-завода (self-chaining конечный автомат).
-- Кокпит ставит джобу → тики (/api/factory/jobs/tick) двигают её по шагам серверно,
-- каждый шаг < 60с (лимит Vercel), состояние в БД между шагами → вкладку можно закрыть.
create table if not exists public.factory_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'queued',     -- queued | running | polling | done | failed
  step text not null default 'produce',       -- produce | scenario | submit | poll | save | done
  article text,
  hook text,
  mode text not null default 'audience',
  state jsonb not null default '{}'::jsonb,    -- промежуточное: route/engine/scenario/realImg/task_id/video_url/pollCount
  result jsonb,                                -- финал: { catalog_url }
  error text,
  attempts int not null default 0,             -- ошибок текущего шага подряд (giveup при >= MAX)
  lease_until timestamptz,                     -- лиз для claim: пока в будущем — джоба «занята» тиком
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
-- быстрый поиск готовой к работе джобы (claimNextJob)
create index if not exists factory_jobs_runnable on public.factory_jobs (status, lease_until, created_at);
alter table public.factory_jobs enable row level security;
create policy "all" on public.factory_jobs for all using (true) with check (true);
