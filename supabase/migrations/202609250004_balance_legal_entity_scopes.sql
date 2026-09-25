-- Баланс строится отдельно по каждому юрлицу. Для фулфилмента кабинет не
-- существует, поэтому принадлежность снимка сохраняется явно.
alter table public.balance_marketplace_stock_runs
  add column if not exists legal_entity_id uuid references public.legal_entities(id) on delete set null;

alter table public.balance_marketplace_stock_lines
  add column if not exists legal_entity_id uuid references public.legal_entities(id) on delete set null;

create index if not exists balance_stock_runs_entity_month_idx
  on public.balance_marketplace_stock_runs (legal_entity_id, snapshot_month);

create index if not exists balance_stock_lines_entity_month_idx
  on public.balance_marketplace_stock_lines (legal_entity_id, snapshot_month);

comment on column public.balance_marketplace_stock_runs.legal_entity_id is
  'Юрлицо для источников без кабинета маркетплейса, прежде всего фулфилмента.';
