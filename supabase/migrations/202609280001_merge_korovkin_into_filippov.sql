-- Коровкин больше не является самостоятельной компанией в финансовом контуре.
-- Исторические записи остаются, но их владельцем становится ИП Филиппов;
-- «Коровкин» распознаётся приложением как алиас Филиппова.
--
-- Миграция намеренно НЕ удаляет исходную строку companies: старые внешние
-- ссылки и аудит остаются валидными. Неактивная строка не показывается в
-- рабочих селекторах, а все рабочие записи переносятся на Филиппова.

do $merge_korovkin_into_filippov$
declare
  v_korovkin uuid;
  v_filippov uuid;
begin
  select id into v_korovkin
  from public.companies
  where lower(name) like '%коровкин%'
  order by id
  limit 1;

  select id into v_filippov
  from public.companies
  where lower(name) like '%филиппов%'
  order by id
  limit 1;

  if v_korovkin is null or v_filippov is null then
    raise exception 'Для объединения нужны обе компании: ИП Коровкин и ИП Филиппов';
  end if;
  if v_korovkin = v_filippov then
    return;
  end if;

  -- Часть операций может быть компонентами цепочки ДДС. Обычный UPDATE
  -- специально запрещён триггером, чтобы не порвать цепочку наполовину.
  -- Миграция меняет только владельца и делает это атомарно: локальный флаг
  -- действует лишь до конца текущей транзакции, а JSON-черновики цепочек
  -- получают тот же canonical id, что и созданные ими платежи.
  perform set_config('finance.chain_edit', 'on', true);
  update public.finance_payment_chains
  set draft = replace(draft::text, v_korovkin::text, v_filippov::text)::jsonb,
      updated_at = now()
  where draft::text like '%' || v_korovkin::text || '%';

  update public.finance_payment_chain_revisions
  set draft = replace(draft::text, v_korovkin::text, v_filippov::text)::jsonb
  where draft::text like '%' || v_korovkin::text || '%';

  -- ДДС и договоры берут компанию через платёж выдачи/оплаты.
  update public.payments
  set company_id = v_filippov
  where company_id = v_korovkin;

  -- Очередь банковской выписки исторически хранит UUID как text.
  update public.bank_review_items
  set company_id = v_filippov::text
  where company_id = v_korovkin::text;

  update public.finance_bank_allocations
  set company_id = v_filippov
  where company_id = v_korovkin;

  update public.finance_loan_documents
  set company_id = v_filippov::text
  where company_id = v_korovkin::text;

  update public.payroll_employees
  set company_id = v_filippov
  where company_id = v_korovkin;

  update public.payroll_employees
  set company_ids = array_replace(company_ids, v_korovkin, v_filippov)
  where v_korovkin = any(company_ids);

  update public.payroll_entries
  set company_id = v_filippov
  where company_id = v_korovkin;

  -- Не удаляем строку физически: так не ломаются исторические ссылки,
  -- однако из всех пользовательских списков она исчезает как неактивная.
  update public.companies
  set is_active = false
  where id = v_korovkin;
end
$merge_korovkin_into_filippov$;
