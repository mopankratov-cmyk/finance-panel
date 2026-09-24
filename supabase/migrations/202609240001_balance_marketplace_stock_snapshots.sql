-- Полный месячный снимок товарных активов для управленческого баланса.
-- Снимается 1-го числа в 00:01 МСК и хранится бессрочно. В одном срезе
-- отдельно живут фулфилмент, склад WB, склад Ozon и товар в пути от поставщика.

create table if not exists public.balance_marketplace_stock_runs (
  snapshot_month date not null,
  source_key text not null,
  source_kind text not null check (source_kind in ('fulfillment', 'wb', 'ozon', 'supplier_transit')),
  source_label text not null,
  marketplace text check (marketplace in ('wb', 'ozon')),
  cabinet_id uuid,
  cabinet_name text,
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
  source_kind text not null check (source_kind in ('fulfillment', 'wb', 'ozon', 'supplier_transit')),
  line_key text not null,
  marketplace text check (marketplace in ('wb', 'ozon')),
  cabinet_id uuid,
  organization_id uuid,
  article text not null,
  product_name text,
  location_name text,
  reference text,
  quantity numeric(18, 3) not null,
  cost_rub numeric(18, 2),
  packaging_rub numeric(18, 2),
  unit_value numeric(18, 2),
  total_value numeric(18, 2),
  captured_at timestamptz not null,
  primary key (snapshot_month, source_key, line_key),
  foreign key (snapshot_month, source_key)
    references public.balance_marketplace_stock_runs(snapshot_month, source_key)
    on delete cascade
);

create index if not exists balance_marketplace_stock_lines_month_idx
  on public.balance_marketplace_stock_lines (snapshot_month, source_kind);

alter table public.balance_marketplace_stock_runs enable row level security;
alter table public.balance_marketplace_stock_lines enable row level security;
revoke all on public.balance_marketplace_stock_runs from anon, authenticated;
revoke all on public.balance_marketplace_stock_lines from anon, authenticated;
grant all on public.balance_marketplace_stock_runs to service_role;
grant all on public.balance_marketplace_stock_lines to service_role;

comment on table public.balance_marketplace_stock_runs is
  'Контроль полноты месячных снимков всех товарных активов на 1-е число 00:01 МСК.';
comment on column public.balance_marketplace_stock_lines.packaging_rub is
  'Упаковка добавляется только для остатков WB/Ozon; фулфилмент и путь от поставщика фиксируются без неё.';

notify pgrst, 'reload schema';
