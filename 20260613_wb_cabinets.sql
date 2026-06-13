-- Кабинеты WB (мультиаккаунт). Токен валидируется через common-api seller-info при добавлении.
create table if not exists public.wb_cabinets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trade_mark text,
  seller_id text,
  inn text,
  token text not null,
  token_advert text,
  token_content text,
  is_active boolean default true,
  created_at timestamptz default now()
);
create unique index if not exists wb_cabinets_seller_uniq on public.wb_cabinets (seller_id) where seller_id is not null;
alter table public.wb_cabinets enable row level security;
create policy "all" on public.wb_cabinets for all using (true) with check (true);
