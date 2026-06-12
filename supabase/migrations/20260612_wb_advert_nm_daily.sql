-- Расход рекламы по артикулам по дням — для реального ДРР в РНП.
create table if not exists public.wb_advert_nm_daily (
  id bigint generated always as identity primary key,
  nm_id bigint not null,
  date date not null,
  views int,
  clicks int,
  spent numeric,
  orders int,
  orders_sum numeric,
  synced_at timestamptz default now(),
  unique (nm_id, date)
);
alter table public.wb_advert_nm_daily enable row level security;
create policy "Allow all access to wb_advert_nm_daily"
  on public.wb_advert_nm_daily for all using (true) with check (true);
