create table if not exists public.wb_stocks_history (
  id bigint generated always as identity primary key,
  nm_id bigint not null,
  warehouse text not null,
  cabinet_id uuid,
  quantity integer,
  in_way_to_client integer,
  in_way_from_client integer,
  snapshot_at timestamptz not null default now()
);

create index if not exists wb_stocks_history_lookup
  on public.wb_stocks_history (nm_id, warehouse, snapshot_at desc);

alter table public.wb_stocks_history enable row level security;

create policy "all"
  on public.wb_stocks_history
  for all
  using (true)
  with check (true);
