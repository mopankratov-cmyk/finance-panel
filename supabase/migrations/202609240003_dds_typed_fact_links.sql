-- Завершение перехода от служебных меток в payments.comment к типизированным
-- связям. Применяется после 202609230001_dds_calendar_fact_links.sql.

-- Там, где каноническая календарная связь уже существует, метка больше не
-- нужна. Неоднозначные старые метки без settled_by_payment_id не трогаем.
update public.payments
set comment = nullif(btrim(regexp_replace(
  coalesce(comment, ''),
  '\s*\[calendar-fact:' || settled_by_payment_id::text || '\]',
  '',
  'g'
)), '')
where settled_by_payment_id is not null
  and coalesce(comment, '') like '%[calendar-fact:' || settled_by_payment_id::text || ']%';

-- У новых графиков источник правды — loan_schedule_rows.paid_by_payment_id.
-- Старые договоры без строк графика сохраняют метки до первого пересохранения.
update public.payments plan
set comment = nullif(btrim(regexp_replace(
  coalesce(plan.comment, ''),
  '\s*\[paid-by:' || schedule.paid_by_payment_id::text || '\]',
  '',
  'g'
)), '')
from public.loan_schedule_rows schedule
where schedule.calendar_payment_id = plan.id
  and schedule.paid_by_payment_id is not null
  and coalesce(plan.comment, '') like '%[paid-by:' || schedule.paid_by_payment_id::text || ']%';

-- Один факт не может одновременно закрыть календарный план и строку кредита.
create or replace function public.ensure_calendar_fact_exclusive()
returns trigger
language plpgsql
set search_path = public
as $ensure_calendar_fact_exclusive$
begin
  if new.settled_by_payment_id is not null and exists (
    select 1 from public.loan_schedule_rows r
    where r.paid_by_payment_id = new.settled_by_payment_id
  ) then
    raise exception 'Факт уже закрывает строку графика кредита' using errcode = '23505';
  end if;
  return new;
end;
$ensure_calendar_fact_exclusive$;

drop trigger if exists payments_calendar_fact_exclusive on public.payments;
create trigger payments_calendar_fact_exclusive
before insert or update of settled_by_payment_id on public.payments
for each row execute function public.ensure_calendar_fact_exclusive();

create or replace function public.ensure_loan_fact_exclusive()
returns trigger
language plpgsql
set search_path = public
as $ensure_loan_fact_exclusive$
begin
  if new.paid_by_payment_id is null then return new; end if;
  if exists (
    select 1 from public.payments p
    where p.settled_by_payment_id = new.paid_by_payment_id
  ) then
    raise exception 'Факт уже закрывает календарный план' using errcode = '23505';
  end if;
  -- Один банковский платёж может закрыть несколько частей одной даты
  -- (тело + проценты), но не другой договор или другую дату.
  if exists (
    select 1 from public.loan_schedule_rows r
    where r.paid_by_payment_id = new.paid_by_payment_id
      and r.id <> new.id
      and (r.loan_id <> new.loan_id or r.due_date <> new.due_date)
  ) then
    raise exception 'Факт уже закрывает другое обязательство по кредиту' using errcode = '23505';
  end if;
  return new;
end;
$ensure_loan_fact_exclusive$;

drop trigger if exists loan_schedule_fact_exclusive on public.loan_schedule_rows;
create trigger loan_schedule_fact_exclusive
before insert or update of paid_by_payment_id on public.loan_schedule_rows
for each row execute function public.ensure_loan_fact_exclusive();

-- Редактор цепочки раньше искал только [calendar-fact:] и [paid-by:]. После
-- удаления меток блокируем отмену использованного факта по каноническим полям.
create or replace function public.protect_linked_fact_from_chain_edit()
returns trigger
language plpgsql
set search_path = public
as $protect_linked_fact_from_chain_edit$
begin
  if coalesce(current_setting('finance.chain_edit', true), '') = 'on'
    and old.status = 'done'
    and new.status = 'cancelled'
    and (
      exists (select 1 from public.payments p where p.settled_by_payment_id = old.id)
      or exists (select 1 from public.loan_schedule_rows r where r.paid_by_payment_id = old.id)
    )
  then
    raise exception 'Операция уже закрывает план или кредит. Сначала отмените сверку.' using errcode = 'P0001';
  end if;
  return new;
end;
$protect_linked_fact_from_chain_edit$;

drop trigger if exists protect_linked_fact_chain_edit on public.payments;
create trigger protect_linked_fact_chain_edit
before update of status on public.payments
for each row execute function public.protect_linked_fact_from_chain_edit();

notify pgrst, 'reload schema';
