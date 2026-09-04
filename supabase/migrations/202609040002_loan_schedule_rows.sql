-- График кредита как сущность (docs/tz/dds-loan-schedule-entity.md, PR-A).
-- До этого график хранился как платежи ДДС с метками в comment; остатка долга
-- на дату не существовало, капитализацию и допвзносы выразить было нечем.

create table if not exists public.loan_schedule_rows (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null,
  due_date date not null,
  kind text not null check (kind in ('principal', 'interest', 'penalty', 'fine', 'fee')),
  amount_rub numeric not null default 0,
  amount_original numeric,
  currency text not null default 'RUB',
  status text not null default 'planned' check (status in ('planned', 'paid', 'cancelled')),
  paid_by_payment_id uuid,
  calendar_payment_id uuid,
  original_due_date date,
  balance_before numeric,
  balance_after numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists loan_schedule_rows_calendar_payment_unique
  on public.loan_schedule_rows (calendar_payment_id) where calendar_payment_id is not null;
create index if not exists loan_schedule_rows_loan_due_idx on public.loan_schedule_rows (loan_id, due_date);
alter table public.loan_schedule_rows enable row level security;

-- Условия договора — источник для расчёта графика (lib/loans/scheduleModel.ts).
alter table public.loans
  add column if not exists annual_rate numeric,
  add column if not exists monthly_rate numeric,
  add column if not exists interest_frequency text,
  add column if not exists rate_mode text not null default 'actual_days',
  add column if not exists day_count_basis integer not null default 365,
  add column if not exists interest_payout text not null default 'paid',
  add column if not exists reinvest_every_periods integer,
  add column if not exists extra_contributions jsonb not null default '[]'::jsonb,
  add column if not exists tranches jsonb not null default '[]'::jsonb;

-- Бэкфилл строк графика из меток в платежах. Идемпотентно: одна строка на платёж.
insert into public.loan_schedule_rows (loan_id, due_date, kind, amount_rub, amount_original, currency, status, paid_by_payment_id, calendar_payment_id, original_due_date)
select
  (regexp_match(p.comment, '\[loan:([0-9a-fA-F-]{36}):schedule:'))[1]::uuid,
  p.date,
  (regexp_match(p.comment, ':schedule:[^:\]]+:(principal|interest|penalty|fine)\]'))[1],
  abs(p.amount),
  nullif((regexp_match(p.comment, '\[amount-original:([0-9.]+)\]'))[1], '')::numeric,
  coalesce((regexp_match(p.comment, '\[currency:([A-Z]{3})\]'))[1], 'RUB'),
  case
    when p.comment like '%[paid-by:%' or p.status = 'done' then 'paid'
    when p.status = 'cancelled' then 'cancelled'
    else 'planned'
  end,
  (regexp_match(p.comment, '\[paid-by:([0-9a-fA-F-]{36})\]'))[1]::uuid,
  p.id,
  (regexp_match(p.comment, '\[original-due:(\d{4}-\d{2}-\d{2})\]'))[1]::date
from public.payments p
where p.comment ~ '\[loan:[0-9a-fA-F-]{36}:schedule:[^:\]]+:(principal|interest|penalty|fine)\]'
on conflict (calendar_payment_id) where calendar_payment_id is not null do nothing;

comment on table public.loan_schedule_rows is 'Строки графика кредита: остаток до/после, чем закрыта. Плановые платежи в payments — производные от строк.';
