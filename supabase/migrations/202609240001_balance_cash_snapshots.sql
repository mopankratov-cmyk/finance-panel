-- Денежные средства маркетплейсов фиксируются в ту же минуту, что и товарный
-- остаток Баланса. Банковские остатки здесь не дублируются: их источником
-- истины остаётся зарегистрированная выписка с входящим остатком.
create table if not exists public.balance_marketplace_cash_snapshots (
  snapshot_month date not null,
  source_key text not null,
  marketplace text not null check (marketplace in ('wb','ozon')),
  cabinet_id uuid references public.wb_cabinets(id) on delete set null,
  cabinet_name text,
  organization_id uuid,
  amount numeric,
  available_amount numeric,
  currency text not null default 'RUB',
  status text not null check (status in ('ok','error')),
  error text,
  captured_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (snapshot_month, source_key)
);

create index if not exists balance_marketplace_cash_month_idx
  on public.balance_marketplace_cash_snapshots(snapshot_month, marketplace);

alter table public.balance_marketplace_cash_snapshots enable row level security;
revoke all on public.balance_marketplace_cash_snapshots from anon, authenticated;
grant all on public.balance_marketplace_cash_snapshots to service_role;

comment on column public.balance_marketplace_cash_snapshots.amount is
  'Полная сумма средств продавца у маркетплейса на момент снимка: WB current / Ozon closing_balance.';
comment on column public.balance_marketplace_cash_snapshots.available_amount is
  'Справочная сумма, доступная к выводу сейчас; в итог Баланса отдельно не прибавляется.';
