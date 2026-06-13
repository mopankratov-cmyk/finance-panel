-- Ozon Performance API (реклама): отдельные OAuth-креды на кабинет.
alter table public.wb_cabinets add column if not exists perf_client_id text;
alter table public.wb_cabinets add column if not exists perf_secret text;
