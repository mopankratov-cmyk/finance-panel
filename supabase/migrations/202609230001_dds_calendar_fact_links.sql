-- Каноническая связь обычного календарного плана с фактом ДДС.
-- Текстовая метка [calendar-fact:...] остаётся на переходный период, но больше
-- не является единственным местом, где хранится связь.

alter table public.payments
  add column if not exists settled_by_payment_id uuid;

-- Переносим только однозначные старые связи. На 23.09.2026 в новой базе есть
-- два факта, ошибочно указанных сразу у двух планов. Их нельзя выбирать
-- автоматически: они остаются в старых метках до ручного разбора.
with parsed as (
  select distinct
    p.id as plan_id,
    ((regexp_match(
      p.comment,
      '\[calendar-fact:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\]'
    ))[1])::uuid as fact_id
  from public.payments p
  where p.comment ~ '\[calendar-fact:[0-9a-fA-F-]{36}\]'
), unambiguous as (
  select fact_id, min(plan_id::text)::uuid as plan_id
  from parsed
  group by fact_id
  having count(*) = 1
)
update public.payments plan
set settled_by_payment_id = link.fact_id
from unambiguous link
where plan.id = link.plan_id
  and plan.settled_by_payment_id is null
  and exists (select 1 from public.payments fact where fact.id = link.fact_id);

do $calendar_fact_constraint$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payments'::regclass
      and conname = 'payments_settled_by_payment_id_fkey'
  ) then
    alter table public.payments
      add constraint payments_settled_by_payment_id_fkey
      foreign key (settled_by_payment_id) references public.payments(id) on delete set null;
  end if;
end;
$calendar_fact_constraint$;

create unique index if not exists payments_one_plan_per_fact_idx
  on public.payments (settled_by_payment_id)
  where settled_by_payment_id is not null;

create or replace function public.normalize_calendar_fact_unlink()
returns trigger
language plpgsql
set search_path = public
as $normalize_calendar_fact_unlink$
begin
  if old.settled_by_payment_id is not null
    and new.settled_by_payment_id is null
    and new.status = 'cancelled'
  then
    new.status := 'planned';
    new.comment := nullif(btrim(regexp_replace(
      coalesce(new.comment, ''),
      '\s*\[calendar-fact:' || old.settled_by_payment_id::text || '\]',
      '',
      'g'
    )), '');
  end if;
  return new;
end;
$normalize_calendar_fact_unlink$;

drop trigger if exists calendar_fact_unlink_status on public.payments;
create trigger calendar_fact_unlink_status
before update of settled_by_payment_id on public.payments
for each row execute function public.normalize_calendar_fact_unlink();

-- Обновляем безопасное удаление: сначала используются канонические ссылки,
-- а старые метки остаются резервом для неоднозначных строк до их разбора.
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

  with restored as (
    update public.payments p
    set
      status = case when p.status = 'cancelled' then 'planned' else p.status end,
      comment = nullif(btrim(regexp_replace(
        coalesce(p.comment, ''),
        '\s*\[paid-by:' || p_payment_id::text || '\]',
        '',
        'g'
      )), '')
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

  with restored as (
    update public.payments p
    set
      status = case when p.status = 'cancelled' then 'planned' else p.status end,
      settled_by_payment_id = null,
      comment = nullif(btrim(regexp_replace(
        coalesce(p.comment, ''),
        '\s*\[calendar-fact:' || p_payment_id::text || '\]',
        '',
        'g'
      )), '')
    where p.id <> p_payment_id
      and (
        p.settled_by_payment_id = p_payment_id
        or coalesce(p.comment, '') like '%[calendar-fact:' || p_payment_id::text || ']%'
      )
    returning p.id
  )
  select count(*) into v_reopened_calendar_plans from restored;

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

comment on column public.payments.settled_by_payment_id is
  'Фактический платёж, который закрыл календарный план. Метка в comment — только совместимость.';

