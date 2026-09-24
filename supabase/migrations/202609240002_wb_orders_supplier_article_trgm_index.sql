-- ОПиУ фильтрует агентский кабинет Оптимы по префиксу артикула
-- (supplier_article ilike 'ESC%'/ 'NV-%' / 'HT-%'). Без подходящего индекса
-- PostgreSQL просматривает весь wb_orders: получение 248 нужных заказов
-- Riobox за август занимало около 24 секунд.
--
-- pg_trgm уже включён миграцией индекса wb_report_rows от 18.09.2026.
-- В файле намеренно РОВНО ОДИН SQL-оператор: Supabase оборачивает пакет из
-- нескольких операторов в транзакцию, а CONCURRENTLY внутри неё запрещён.

create index concurrently if not exists wb_orders_supplier_article_trgm_idx
  on public.wb_orders using gin (supplier_article gin_trgm_ops);
