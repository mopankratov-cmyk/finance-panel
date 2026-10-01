-- Одно удержание WB может покрывать несколько недельных строк графика.
-- Отдельный журнал хранит суммы распределения, а не заставляет выбирать
-- произвольную единственную строку и не теряет остаток удержания.

create table if not exists public.loan_schedule_marketplace_allocations (
  id uuid primary key default gen_random_uuid(),
  schedule_row_id uuid not null references public.loan_schedule_rows(id) on delete cascade,
  marketplace_source text not null,
  amount_rub numeric not null check (amount_rub > 0),
  created_at timestamptz not null default now(),
  unique (schedule_row_id, marketplace_source)
);

create index if not exists loan_schedule_marketplace_allocations_source_idx
  on public.loan_schedule_marketplace_allocations (marketplace_source);

-- Раньше один источник удержания мог закрыть только одну строку. Для
-- недельных графиков это неверно: одно агрегированное удержание WB часто
-- закрывает несколько последовательных строк одного вида.
drop index if exists public.loan_schedule_rows_marketplace_source_unique;

alter table public.loan_schedule_marketplace_allocations enable row level security;
revoke all on public.loan_schedule_marketplace_allocations from anon, authenticated;
grant all on public.loan_schedule_marketplace_allocations to service_role;

comment on table public.loan_schedule_marketplace_allocations is
  'Распределение одного удержания маркетплейса по строкам графика кредита. Сумма хранится отдельно для аудита и частичных зачётов.';
