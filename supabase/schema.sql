-- Run this in the Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)

create extension if not exists "pgcrypto";

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null,
  currency text not null default 'RUB',
  balance numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  amount numeric not null,
  type text not null check (type in ('income', 'expense')),
  category text not null,
  account_id uuid not null references public.accounts (id) on delete cascade,
  date date not null,
  status text not null default 'planned' check (status in ('planned', 'done', 'cancelled')),
  counterparty text not null default '',
  comment text,
  created_at timestamptz not null default now()
);

create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  creditor text not null,
  principal numeric not null,
  rate_per_day numeric not null,
  start_date date not null,
  due_date date not null,
  status text not null default 'active' check (status in ('active', 'closed')),
  created_at timestamptz not null default now()
);

create index if not exists payments_date_idx on public.payments (date);
create index if not exists payments_account_id_idx on public.payments (account_id);

alter table public.accounts enable row level security;
alter table public.payments enable row level security;
alter table public.loans enable row level security;

create policy "Allow all access to accounts"
  on public.accounts for all
  using (true)
  with check (true);

create policy "Allow all access to payments"
  on public.payments for all
  using (true)
  with check (true);

create policy "Allow all access to loans"
  on public.loans for all
  using (true)
  with check (true);
