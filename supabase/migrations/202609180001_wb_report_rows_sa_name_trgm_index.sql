-- Индекс по sa_name (артикул) в финансовом отчёте WB — для фильтрации
-- суб-брендов внутри общего кабинета по префиксу артикула (ESC-/NV-/HT-:
-- Riobox/Norvia/Heaton).
--
-- Кабинет Оптима — агентский, до ~116k строк отчёта/день, 92% из них чужие
-- товары других продавцов через тот же кабинет (см. docs/PROJECT-KNOWLEDGE.md
-- §3). Запрос `sa_name ilike 'ESC%'` без индекса вынужден построчно читать и
-- сравнивать ВСЕ строки месяца, а не только тот 1%, что реально относится к
-- Riobox/Heaton/Norvia — падает по statement timeout уже на диапазоне в
-- 9-10 дней (см. lib/opiu/loadMonth.ts/reportRows.ts, PR с починкой запроса).
-- Обычный btree по sa_name тут не поможет: ilike регистронезависимый, а
-- варианты префиксов встречаются то в верхнем, то в нижнем регистре — нужен
-- триграммный GIN-индекс (pg_trgm), который ускоряет и ilike 'prefix%', и
-- произвольный ilike '%подстрока%'.
--
-- CONCURRENTLY — чтобы не блокировать запись: в эту таблицу постоянно пишет
-- синк отчёта (lib/opiu/syncReportRows.ts). ВАЖНО: такой оператор нельзя
-- выполнять внутри транзакции — в SQL-редакторе Supabase выполнять его
-- ОТДЕЛЬНО, одним запросом (как и extension ниже, тоже вне транзакции).

create extension if not exists pg_trgm;

create index concurrently if not exists wb_report_rows_sa_name_trgm_idx
  on public.wb_report_rows using gin (sa_name gin_trgm_ops);

comment on index public.wb_report_rows_sa_name_trgm_idx is
  'Для фильтра суб-бренда по префиксу артикула (ОПиУ, Оптима/Retail Family) — без него ilike-фильтр сканирует всю таблицу.';
