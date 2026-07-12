-- Устойчивые курсоры WB API и состояние асинхронного годового отчёта.
-- Отдельная таблица нужна, потому что date заказа/продажи не является курсором
-- statistics-api: продолжать выгрузку надо по lastChangeDate.
create table if not exists public.wb_sync_state (
  cabinet_id uuid not null references public.wb_cabinets(id) on delete cascade,
  job text not null,
  cursor text,
  status text not null default 'pending',
  attempts int not null default 0,
  last_error text,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (cabinet_id, job)
);

create index if not exists wb_sync_state_updated_at_idx
  on public.wb_sync_state (updated_at desc);

alter table public.wb_sync_state enable row level security;

-- Таблица доступна только серверному service-role, который обходит RLS.
-- Клиентские политики намеренно не создаём: курсоры и ошибки не должны
-- редактироваться из браузера.
