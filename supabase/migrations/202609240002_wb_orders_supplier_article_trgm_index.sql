-- ОПиУ фильтрует агентский кабинет Оптимы по префиксу артикула
-- (supplier_article ilike 'ESC%'/ 'NV-%' / 'HT-%'). Без подходящего индекса
-- PostgreSQL просматривает весь wb_orders: получение 248 нужных заказов
-- Riobox за август занимало около 24 секунд.
--
-- CONCURRENTLY нельзя выполнять внутри транзакции. В SQL Editor Supabase
-- выполнить этот файл отдельным запросом.

create extension if not exists pg_trgm;

create index concurrently if not exists wb_orders_supplier_article_trgm_idx
  on public.wb_orders using gin (supplier_article gin_trgm_ops);

comment on index public.wb_orders_supplier_article_trgm_idx is
  'Префиксный фильтр бренда в агентском кабинете для месячного ОПиУ.';
