-- Расход рекламы Ozon по дням на товар.
--
-- Раньше он хранился скользящим окном «последние N дней» и отвечал только на
-- один вопрос — за эти N дней. На экране с периодом 01.08-26.08 окно молчит,
-- и колонка «Реклама/шт.» показывает нули: не «рекламы не было», а «мы не
-- знаем». Посуточные строки складываются под любой период, как это уже
-- сделано для WB в wb_advert_nm_daily.
create table if not exists public.ozon_ad_daily (
  client_id text not null,
  sku text not null,
  date date not null,
  spent numeric not null default 0,
  orders_money numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (client_id, sku, date)
);

create index if not exists ozon_ad_daily_client_date_idx
  on public.ozon_ad_daily (client_id, date, sku);

alter table public.ozon_ad_daily enable row level security;
drop policy if exists "service role manages ozon ad daily" on public.ozon_ad_daily;
create policy "service role manages ozon ad daily"
  on public.ozon_ad_daily for all using (true) with check (true);
