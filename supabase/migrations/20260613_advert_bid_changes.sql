-- Журнал всех изменений ставок (аудит).
create table if not exists public.advert_bid_changes (
  id bigint generated always as identity primary key,
  advert_id bigint not null,
  old_bid numeric,
  new_bid numeric,
  status text not null,          -- ok | error | rejected
  detail text,                   -- ответ WB или причина отказа
  created_at timestamptz default now()
);
alter table public.advert_bid_changes enable row level security;
create policy "all" on public.advert_bid_changes for all using (true) with check (true);
