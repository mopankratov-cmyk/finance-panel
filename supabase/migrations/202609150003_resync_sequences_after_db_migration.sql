-- Переезд базы 15.09.2026 (Sydney -> eu-central) перенёс данные, но не
-- перевёл счётчики serial/bigserial вперёд: новые INSERT пытаются взять id,
-- которые уже заняты скопированными строками, и падают с "duplicate key
-- value violates unique constraint ...". Живьём поймано на sync_log
-- (job=stocks-history, sales, orders, kiz-codes, adverts, fbs-orders,
-- advert-stats, fbs-stocks, advert-spend-history, paid-storage, ozon-adverts,
-- feedbacks) и на access_audit_log (auth.login.failed) — вероятно, задета
-- любая таблица с serial-PK, восстановленная переездом. Синхронизирует все
-- sequence публичной схемы с фактическим MAX(id) их таблиц; безопасно
-- перезапускать (idempotent), данные не трогает.
DO $$
DECLARE
  rec RECORD;
  next_val bigint;
BEGIN
  FOR rec IN
    SELECT
      seq.relname AS sequence_name,
      tab.relname AS table_name,
      col.attname AS column_name
    FROM pg_class seq
    JOIN pg_depend dep ON dep.objid = seq.oid AND dep.deptype = 'a'
    JOIN pg_class tab ON dep.refobjid = tab.oid
    JOIN pg_attribute col ON col.attrelid = tab.oid AND col.attnum = dep.refobjsubid
    JOIN pg_namespace ns ON ns.oid = seq.relnamespace
    WHERE seq.relkind = 'S'
      AND ns.nspname = 'public'
  LOOP
    EXECUTE format(
      'SELECT COALESCE(MAX(%I), 0) + 1 FROM public.%I',
      rec.column_name, rec.table_name
    ) INTO next_val;

    PERFORM setval(format('public.%I', rec.sequence_name), next_val, false);

    RAISE NOTICE 'resynced %.% -> next value %', rec.table_name, rec.column_name, next_val;
  END LOOP;
END $$;
