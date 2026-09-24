-- Расширяет уже опубликованный снимок маркетплейсов до полного снимка
-- товарных активов, не переписывая миграцию 202609240001 задним числом.

alter table public.balance_marketplace_stock_runs
  add column if not exists source_kind text,
  add column if not exists source_label text;

update public.balance_marketplace_stock_runs
set source_kind = marketplace,
    source_label = concat(upper(marketplace), ' · ', cabinet_name)
where source_kind is null or source_label is null;

alter table public.balance_marketplace_stock_runs
  alter column source_kind set not null,
  alter column source_label set not null,
  alter column marketplace drop not null,
  alter column cabinet_name drop not null;

alter table public.balance_marketplace_stock_runs
  drop constraint if exists balance_marketplace_stock_runs_marketplace_check,
  add constraint balance_marketplace_stock_runs_marketplace_check
    check (marketplace is null or marketplace in ('wb', 'ozon')),
  add constraint balance_marketplace_stock_runs_source_kind_check
    check (source_kind in ('fulfillment', 'wb', 'ozon', 'supplier_transit'));

alter table public.balance_marketplace_stock_lines
  add column if not exists source_kind text,
  add column if not exists line_key text,
  add column if not exists location_name text,
  add column if not exists reference text;

update public.balance_marketplace_stock_lines
set source_kind = marketplace,
    line_key = article
where source_kind is null or line_key is null;

alter table public.balance_marketplace_stock_lines
  alter column source_kind set not null,
  alter column line_key set not null,
  alter column marketplace drop not null;

alter table public.balance_marketplace_stock_lines
  drop constraint if exists balance_marketplace_stock_lines_marketplace_check,
  add constraint balance_marketplace_stock_lines_marketplace_check
    check (marketplace is null or marketplace in ('wb', 'ozon')),
  add constraint balance_marketplace_stock_lines_source_kind_check
    check (source_kind in ('fulfillment', 'wb', 'ozon', 'supplier_transit'));

alter table public.balance_marketplace_stock_lines
  drop constraint if exists balance_marketplace_stock_lines_pkey,
  add primary key (snapshot_month, source_key, line_key);

create index if not exists balance_marketplace_stock_lines_kind_idx
  on public.balance_marketplace_stock_lines (snapshot_month, source_kind);

comment on table public.balance_marketplace_stock_runs is
  'Контроль полноты месячных снимков всех товарных активов на 1-е число 00:01 МСК.';
comment on column public.balance_marketplace_stock_lines.packaging_rub is
  'Упаковка добавляется только для остатков WB/Ozon; фулфилмент и путь от поставщика фиксируются без неё.';

notify pgrst, 'reload schema';
