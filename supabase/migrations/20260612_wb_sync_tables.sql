-- WB sync tables for Этап 1
-- Run in Supabase SQL Editor

create table if not exists public.wb_orders (
  id bigint generated always as identity primary key,
  srid text unique,
  nm_id bigint not null,
  supplier_article text,
  date timestamptz not null,
  total_price numeric,
  discount_percent numeric,
  finished_price numeric,
  is_cancel boolean default false,
  warehouse text,
  region text,
  synced_at timestamptz default now()
);
create index if not exists wb_orders_nm_id_date_idx on public.wb_orders (nm_id, date);

create table if not exists public.wb_sales (
  id bigint generated always as identity primary key,
  sale_id text unique,
  nm_id bigint not null,
  date timestamptz not null,
  for_pay numeric,
  finished_price numeric,
  synced_at timestamptz default now()
);
create index if not exists wb_sales_nm_id_date_idx on public.wb_sales (nm_id, date);

create table if not exists public.wb_stocks (
  id bigint generated always as identity primary key,
  nm_id bigint not null,
  warehouse text not null,
  quantity int,
  in_way_to_client int,
  in_way_from_client int,
  synced_at timestamptz default now(),
  unique (nm_id, warehouse)
);

create table if not exists public.wb_adverts (
  id bigint generated always as identity primary key,
  advert_id bigint unique,
  name text,
  type int,
  status int,
  daily_budget numeric,
  synced_at timestamptz default now()
);

create table if not exists public.wb_advert_stats (
  id bigint generated always as identity primary key,
  advert_id bigint not null,
  date date not null,
  views int,
  clicks int,
  ctr numeric,
  cpc numeric,
  sum_spent numeric,
  orders int,
  sum_orders numeric,
  unique (advert_id, date)
);

create table if not exists public.wb_funnel_daily (
  id bigint generated always as identity primary key,
  nm_id bigint not null,
  date date not null,
  open_card int,
  add_to_cart int,
  orders int,
  orders_sum numeric,
  buyouts int,
  buyout_sum numeric,
  unique (nm_id, date)
);

create table if not exists public.sync_log (
  id bigint generated always as identity primary key,
  job text not null,
  status text not null,
  rows_affected int,
  error text,
  started_at timestamptz,
  finished_at timestamptz default now()
);

create table if not exists public.agent_insights (
  id bigint generated always as identity primary key,
  module text not null,
  severity text not null,
  title text not null,
  body text not null,
  data jsonb,
  is_read boolean default false,
  created_at timestamptz default now()
);

-- RLS
alter table public.wb_orders enable row level security;
alter table public.wb_sales enable row level security;
alter table public.wb_stocks enable row level security;
alter table public.wb_adverts enable row level security;
alter table public.wb_advert_stats enable row level security;
alter table public.wb_funnel_daily enable row level security;
alter table public.sync_log enable row level security;
alter table public.agent_insights enable row level security;

create policy "Allow all access to wb_orders" on public.wb_orders for all using (true) with check (true);
create policy "Allow all access to wb_sales" on public.wb_sales for all using (true) with check (true);
create policy "Allow all access to wb_stocks" on public.wb_stocks for all using (true) with check (true);
create policy "Allow all access to wb_adverts" on public.wb_adverts for all using (true) with check (true);
create policy "Allow all access to wb_advert_stats" on public.wb_advert_stats for all using (true) with check (true);
create policy "Allow all access to wb_funnel_daily" on public.wb_funnel_daily for all using (true) with check (true);
create policy "Allow all access to sync_log" on public.sync_log for all using (true) with check (true);
create policy "Allow all access to agent_insights" on public.agent_insights for all using (true) with check (true);
