-- Безопасное удаление ошибочно внесённого факта ДДС.
--
-- Один факт может закрывать строку кредита, план календаря и распределение
-- зарплаты. Обычный DELETE payments удалял только сам факт: кредит и календарь
-- оставались «оплаченными» без существующей операции. RPC выполняет снятие
-- связей и удаление в одной транзакции.

create or replace function public.delete_dds_payment(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $delete_dds_payment$
declare
  v_deleted integer := 0;
  v_reopened_loan_rows integer := 0;
  v_reopened_calendar_plans integer := 0;
begin
  if not exists (select 1 from public.payments where id = p_payment_id) then
    raise exception 'Платёж ДДС не найден';
  end if;

  -- Сначала возвращаем производные платежи кредита в план. Их id нужны до
  -- очистки paid_by_payment_id в строках графика.
  with restored as (
    update public.payments p
    set
      status = case when p.status = 'cancelled' then 'planned' else p.status end,
      comment = btrim(regexp_replace(
        coalesce(p.comment, ''),
        '\s*\[paid-by:' || p_payment_id::text || '\]',
        '',
        'g'
      ))
    where p.id in (
      select r.calendar_payment_id
      from public.loan_schedule_rows r
      where r.paid_by_payment_id = p_payment_id
        and r.calendar_payment_id is not null
    )
    returning p.id
  )
  select count(*) into v_reopened_loan_rows from restored;

  update public.loan_schedule_rows
  set status = 'planned', paid_by_payment_id = null, updated_at = now()
  where paid_by_payment_id = p_payment_id
    and paid_by_marketplace_source is null;

  -- Обычные планы календаря хранят связь в совместимой метке.
  with restored as (
    update public.payments p
    set
      status = case when p.status = 'cancelled' then 'planned' else p.status end,
      comment = btrim(regexp_replace(
        coalesce(p.comment, ''),
        '\s*\[calendar-fact:' || p_payment_id::text || '\]',
        '',
        'g'
      ))
    where p.id <> p_payment_id
      and coalesce(p.comment, '') like '%[calendar-fact:' || p_payment_id::text || ']%'
    returning p.id
  )
  select count(*) into v_reopened_calendar_plans from restored;

  -- payroll_payment_allocations удаляются штатным FK ON DELETE CASCADE;
  -- salary_payment_id/tax_payment_id обнуляются их FK ON DELETE SET NULL.
  delete from public.payments where id = p_payment_id;
  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'deleted', v_deleted = 1,
    'reopenedLoanRows', v_reopened_loan_rows,
    'reopenedCalendarPlans', v_reopened_calendar_plans
  );
end;
$delete_dds_payment$;

revoke all on function public.delete_dds_payment(uuid) from public;
grant execute on function public.delete_dds_payment(uuid) to service_role;

comment on function public.delete_dds_payment(uuid) is
  'Удаляет факт ДДС транзакционно: снимает связи кредита/календаря; зарплатные распределения удаляются FK.';
