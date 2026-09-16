-- Миграция 202609150003 (переезд базы 15.09.2026, Sydney -> eu-central)
-- синхронизировала счётчики serial/bigserial, но фильтровала
-- pg_depend.deptype = 'a' — это тип зависимости для SERIAL/BIGSERIAL.
-- У колонок `generated always as identity` (используются почти везде в
-- схеме: ctr_tests, ctr_variants, access_audit_log, wb_*_daily и ещё ~25
-- таблиц) зависимость в pg_depend другая — 'i' (internal), и такие
-- sequence прошлой миграцией не были задеты вовсе.
--
-- Symptom: "duplicate key value violates unique constraint ctr_variants_pkey"
-- при создании нового CTR-теста 16.09 — ctr_variants.id тоже identity,
-- её sequence всё ещё указывала на доотъездное значение. Та же дыра
-- потенциально ждёт в любой другой identity-таблице, куда со дня переезда
-- ещё не писали новую строку.
--
-- Ловит оба типа зависимости разом (без фильтра по deptype вообще —
-- pg_depend содержит owned-by связь колонка->sequence только для
-- SERIAL/IDENTITY, других случаев тут не бывает). Безопасно перезапускать.
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
    JOIN pg_depend dep ON dep.objid = seq.oid AND dep.deptype IN ('a', 'i')
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
