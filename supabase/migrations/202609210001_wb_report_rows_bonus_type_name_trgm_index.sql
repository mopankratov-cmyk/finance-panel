-- Индекс по bonus_type_name в финансовом отчёте WB — для поиска строк
-- "Перевод на баланс заёмщика..." (lib/opiu/reportRows.ts: fetchLoanTransferRows,
-- lib/opiu/metrics.ts: loanTransferRub). Продолжение
-- 202609180001_wb_report_rows_sa_name_trgm_index.sql: тот индекс закрыл
-- таймаут в основном запросе отчёта, но fetchLoanTransferRows фильтрует по
-- ДРУГОЙ колонке (bonus_type_name) — без своего индекса она осталась
-- незакрытой дырой и по-прежнему падает по statement timeout на Оптиме.
--
-- Точное совпадение (=/IN) не подходит: в каждую строку "Перевод на баланс
-- заёмщика..." зашит конкретный номер кредита и дата, поэтому текст всегда
-- разный — нужен именно префиксный/подстроковый поиск (ilike), как и для
-- sa_name. Регистр в данных стабильно с заглавной "Перевод" (это готовая
-- метка WB, не вводится продавцом, в отличие от sa_name), но ilike всё
-- равно надёжнее на случай отклонений.
--
-- CONCURRENTLY — чтобы не блокировать запись: в эту таблицу постоянно пишет
-- синк отчёта (lib/opiu/syncReportRows.ts). ВАЖНО: такой оператор нельзя
-- выполнять внутри транзакции — в SQL-редакторе Supabase выполнять его
-- ОТДЕЛЬНО, одним запросом (extension уже создан прошлой миграцией).

create index concurrently if not exists wb_report_rows_bonus_type_name_trgm_idx
  on public.wb_report_rows using gin (bonus_type_name gin_trgm_ops);

comment on index public.wb_report_rows_bonus_type_name_trgm_idx is
  'Для fetchLoanTransferRows (ОПиУ, "перевод на баланс заёмщика") — без него ilike-фильтр сканирует всю таблицу.';
