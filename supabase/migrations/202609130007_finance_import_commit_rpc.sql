-- Импорт ДДС (аудит P2, целостность данных): POST app/api/finance/import/route.ts
-- писал счета, привязки платежей к юрлицам и сами платежи ТРЕМЯ отдельными
-- шагами — insertChunked(accounts), затем цикл update company_id, затем
-- insertChunked(payments) — каждый со своими собственными запросами к базе.
-- Обрыв соединения или таймаут на любом из шагов (а он мог быть не первым:
-- счета уже вставлены) оставлял импорт в частично применённом состоянии —
-- счёт есть, а платежей по нему нет, или платежи есть, а привязка к юрлицу
-- не прошла — и понять постфактум, что именно уцелело, можно было только по
-- логам, вручную.
--
-- Функция сводит все три шага в один RPC-вызов: один вызов plpgsql-функции —
-- одна транзакция Postgres целиком, обрыв на любом шаге откатывает всё, а не
-- часть. Повторный вызов с тем же планом после сбоя не плодит дублей: счета
-- вставляются по id (on conflict do nothing — id генерирует клиент заранее,
-- см. components/payments/ddsImport.ts), платежи — по import_source (тот же
-- уникальный индекс payments_import_source_unique из
-- 20260727_finance_bank_import_idempotency.sql, что раньше использовал
-- upsert(..., { onConflict: "import_source", ignoreDuplicates: true })).
--
-- route.ts остаётся с фолбэком на прежний многошаговый путь на случай, если
-- эта миграция ещё не накатана (ошибка 42883/42P01 — функции ещё нет) — по
-- конвенции этого проекта (см., например, missingMigration(...) в
-- app/api/warehouse/transfers/route.ts).

create or replace function public.commit_finance_import(
  p_accounts jsonb default '[]'::jsonb,
  p_payments jsonb default '[]'::jsonb,
  p_company_updates jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $commit_finance_import$
declare
  v_accounts_created integer := 0;
  v_payments_created integer := 0;
begin
  -- 1) Счета — сперва, платежи ниже на них ссылаются (account_id not null
  -- references accounts). on conflict(id) — повтор после сбоя не дублирует
  -- уже созданный счёт.
  if p_accounts is not null and jsonb_typeof(p_accounts) = 'array' and jsonb_array_length(p_accounts) > 0 then
    with inserted as (
      insert into public.accounts (id, name, type, currency, balance)
      select
        (item->>'id')::uuid,
        item->>'name',
        item->>'type',
        item->>'currency',
        coalesce((item->>'balance')::numeric, 0)
      from jsonb_array_elements(p_accounts) as item
      on conflict (id) do nothing
      returning 1
    )
    select count(*) into v_accounts_created from inserted;
  end if;

  -- 2) Привязка уже существующих платежей к юрлицу (точный дубль по
  -- дате+сумме+статье+кошельку+названию нашёлся без компании — см.
  -- buildImportPlan в components/payments/ddsImport.ts). Обычный update —
  -- идемпотентен сам по себе: повтор ставит то же company_id.
  if p_company_updates is not null and jsonb_typeof(p_company_updates) = 'array' and jsonb_array_length(p_company_updates) > 0 then
    update public.payments p
    set company_id = u.company_id
    from (
      select
        (item->>'paymentId')::uuid as payment_id,
        (item->>'companyId')::uuid as company_id
      from jsonb_array_elements(p_company_updates) as item
    ) u
    where p.id = u.payment_id;
  end if;

  -- 3) Новые платежи (точно новые + принятые «под вопросом»). on
  -- conflict(import_source) — тот же смысл, что раньше давал
  -- ignoreDuplicates на upsert: повтор пропускает уже вставленные строки,
  -- а не плодит дубли. import_source может быть NULL (ручной ввод без
  -- источника) — уникальный индекс NULL'ы не считает конфликтующими друг с
  -- другом, ровно как и раньше.
  if p_payments is not null and jsonb_typeof(p_payments) = 'array' and jsonb_array_length(p_payments) > 0 then
    with inserted as (
      insert into public.payments (
        id, name, amount, type, category, account_id, date, status, counterparty, comment, company_id, import_source
      )
      select
        (item->>'id')::uuid,
        item->>'name',
        (item->>'amount')::numeric,
        item->>'type',
        item->>'category',
        (item->>'account_id')::uuid,
        (item->>'date')::date,
        coalesce(item->>'status', 'done'),
        coalesce(item->>'counterparty', ''),
        item->>'comment',
        (item->>'company_id')::uuid,
        item->>'import_source'
      from jsonb_array_elements(p_payments) as item
      on conflict (import_source) do nothing
      returning 1
    )
    select count(*) into v_payments_created from inserted;
  end if;

  return jsonb_build_object(
    'accountsCreated', v_accounts_created,
    'paymentsCreated', v_payments_created
  );
end;
$commit_finance_import$;

revoke all on function public.commit_finance_import(jsonb, jsonb, jsonb) from public;
grant execute on function public.commit_finance_import(jsonb, jsonb, jsonb) to service_role;

notify pgrst, 'reload schema';
