-- Мультимаркетплейс: добавляем Ozon в кабинеты (Client-Id + Api-Key).
alter table public.wb_cabinets add column if not exists marketplace text not null default 'wb';
alter table public.wb_cabinets add column if not exists client_id text; -- Ozon Client-Id (для wb пусто)
-- seller_id уникален в пределах маркетплейса
drop index if exists wb_cabinets_seller_uniq;
create unique index if not exists wb_cabinets_mp_seller_uniq
  on public.wb_cabinets (marketplace, seller_id) where seller_id is not null;
