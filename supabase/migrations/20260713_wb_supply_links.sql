-- P8: привязка WMS dry-run к уже созданным поставкам WB.
-- Официальный FBW API позволяет читать поставку/товары/упаковку, но не загружать
-- упаковку. Поэтому храним только проверяемую ссылку и снимки ответов WB.

create table if not exists public.wms_wb_supply_links (
  id                  uuid primary key default gen_random_uuid(),
  cabinet_id          uuid not null references public.wb_cabinets(id) on delete cascade,
  run_id              uuid not null references public.wms_order_runs(id) on delete cascade,
  warehouse           text not null,
  supply_id           bigint not null check (supply_id > 0),
  status_id           integer,
  box_type_id         integer,
  wb_snapshot         jsonb not null default '{}'::jsonb,
  goods_comparison    jsonb not null default '{}'::jsonb,
  package_comparison  jsonb not null default '{}'::jsonb,
  linked_by           text,
  verified_at         timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique(run_id, warehouse),
  unique(cabinet_id, supply_id)
);

create index if not exists wms_wb_supply_links_cabinet_run_idx
  on public.wms_wb_supply_links(cabinet_id, run_id);

alter table public.wms_wb_supply_links enable row level security;
revoke all on table public.wms_wb_supply_links from anon, authenticated;
grant all on table public.wms_wb_supply_links to service_role;
