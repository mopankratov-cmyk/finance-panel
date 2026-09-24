-- Месячный остаток маркетплейсов для управленческого баланса.
-- Снимок запускается 1-го числа в 00:01 МСК и хранится бессрочно: обычная
-- wb_stocks_history чистится через 90 дней и не содержит оценку по себестоимости.

create table if not exists public.balance_marketplace_stock_runs (
  snapshot_month date not null,
  source_key text not null,
  marketplace text not null check (marketplace in ('wb', 'ozon')),
  cabinet_id uuid,
  cabinet_name text not null,
  organization_id uuid,
  status text not null check (status in ('ok', 'partial', 'error')),
  rows_count integer not null default 0,
  missing_cost_count integer not null default 0,
  total_quantity numeric(18, 3) not null default 0,
  total_value numeric(18, 2),
  captured_at timestamptz not null,
  error text,
  primary key (snapshot_month, source_key)
);

create table if not exists public.balance_marketplace_stock_lines (
  snapshot_month date not null,
  source_key text not null,
  marketplace text not null check (marketplace in ('wb', 'ozon')),
  cabinet_id uuid,
  organization_id uuid,
  article text not null,
  product_name text,
  quantity numeric(18, 3) not null,
  cost_rub numeric(18, 2),
  packaging_rub numeric(18, 2),
  unit_value numeric(18, 2),
  total_value numeric(18, 2),
  captured_at timestamptz not null,
  primary key (snapshot_month, source_key, article),
  foreign key (snapshot_month, source_key)
    references public.balance_marketplace_stock_runs(snapshot_month, source_key)
    on delete cascade
);

create index if not exists balance_marketplace_stock_lines_month_idx
  on public.balance_marketplace_stock_lines (snapshot_month, marketplace);

alter table public.balance_marketplace_stock_runs enable row level security;
alter table public.balance_marketplace_stock_lines enable row level security;
revoke all on public.balance_marketplace_stock_runs from anon, authenticated;
revoke all on public.balance_marketplace_stock_lines from anon, authenticated;
grant all on public.balance_marketplace_stock_runs to service_role;
grant all on public.balance_marketplace_stock_lines to service_role;

comment on table public.balance_marketplace_stock_runs is
  'Контроль полноты месячных снимков остатков маркетплейсов на 1-е число 00:01 МСК.';
comment on column public.balance_marketplace_stock_lines.packaging_rub is
  'Стоимость складской подготовки/упаковки на единицу из product_costs.warehouse_expenses на момент снимка.';

notify pgrst, 'reload schema';
