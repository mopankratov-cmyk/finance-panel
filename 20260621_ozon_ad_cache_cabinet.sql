-- ozon_ad_cache per-кабинет: старый PK (sku,days) мешал 2+ Ozon-кабинета —
-- расход рекламы одного кабинета кэшировался под общим ключом и подменял другой.
-- Добавляем client_id (Ozon Client-Id) в ключ. Старый кэш без кабинета — мусор, пересоберётся из Performance.
-- Безопасно прогнать повторно.
alter table public.ozon_ad_cache add column if not exists client_id text;
delete from public.ozon_ad_cache where client_id is null;
alter table public.ozon_ad_cache alter column client_id set not null;
alter table public.ozon_ad_cache drop constraint if exists ozon_ad_cache_pkey;
alter table public.ozon_ad_cache add primary key (client_id, sku, days);
