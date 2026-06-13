-- Кэш per-SKU расхода рекламы Ozon (async-отчёт Performance медленный → кэшируем).
create table if not exists public.ozon_ad_cache (
  sku text not null,
  days int not null,
  spent numeric default 0,
  orders_money numeric default 0,
  updated_at timestamptz default now(),
  primary key (sku, days)
);
alter table public.ozon_ad_cache enable row level security;
create policy "all" on public.ozon_ad_cache for all using (true) with check (true);
