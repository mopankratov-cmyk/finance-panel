-- Закрепляет связи графика кредита на уровне базы.
-- На 22.09.2026 новая база проверена до применения: осиротевших loan_id,
-- paid_by_payment_id и calendar_payment_id нет. Если они появятся в другом
-- окружении, миграция остановится с точной причиной и ничего не удалит молча.

do $check_loan_schedule_links$
declare
  v_orphan_loans integer;
  v_orphan_facts integer;
  v_orphan_calendar integer;
begin
  select count(*) into v_orphan_loans
  from public.loan_schedule_rows r
  where not exists (select 1 from public.loans l where l.id = r.loan_id);

  select count(*) into v_orphan_facts
  from public.loan_schedule_rows r
  where r.paid_by_payment_id is not null
    and not exists (select 1 from public.payments p where p.id = r.paid_by_payment_id);

  select count(*) into v_orphan_calendar
  from public.loan_schedule_rows r
  where r.calendar_payment_id is not null
    and not exists (select 1 from public.payments p where p.id = r.calendar_payment_id);

  if v_orphan_loans > 0 or v_orphan_facts > 0 or v_orphan_calendar > 0 then
    raise exception
      'loan_schedule_rows содержит осиротевшие связи: договоры %, факты %, календарь %',
      v_orphan_loans, v_orphan_facts, v_orphan_calendar;
  end if;
end;
$check_loan_schedule_links$;

do $loan_schedule_constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.loan_schedule_rows'::regclass
      and conname = 'loan_schedule_rows_loan_id_fkey'
  ) then
    alter table public.loan_schedule_rows
      add constraint loan_schedule_rows_loan_id_fkey
      foreign key (loan_id) references public.loans(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.loan_schedule_rows'::regclass
      and conname = 'loan_schedule_rows_paid_by_payment_id_fkey'
  ) then
    alter table public.loan_schedule_rows
      add constraint loan_schedule_rows_paid_by_payment_id_fkey
      foreign key (paid_by_payment_id) references public.payments(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.loan_schedule_rows'::regclass
      and conname = 'loan_schedule_rows_calendar_payment_id_fkey'
  ) then
    alter table public.loan_schedule_rows
      add constraint loan_schedule_rows_calendar_payment_id_fkey
      foreign key (calendar_payment_id) references public.payments(id) on delete set null;
  end if;
end;
$loan_schedule_constraints$;

-- Страховка для удаления платежа любым серверным путём, а не только через
-- delete_dds_payment: если FK обнулил факт, строка не остаётся «оплаченной».
create or replace function public.normalize_loan_schedule_fact_unlink()
returns trigger
language plpgsql
set search_path = public
as $normalize_loan_schedule_fact_unlink$
begin
  if old.paid_by_payment_id is not null
    and new.paid_by_payment_id is null
    and new.paid_by_marketplace_source is null
    and new.status = 'paid'
  then
    new.status := 'planned';
    new.updated_at := now();
  end if;
  return new;
end;
$normalize_loan_schedule_fact_unlink$;

drop trigger if exists loan_schedule_fact_unlink_status on public.loan_schedule_rows;
create trigger loan_schedule_fact_unlink_status
before update of paid_by_payment_id on public.loan_schedule_rows
for each row execute function public.normalize_loan_schedule_fact_unlink();

comment on constraint loan_schedule_rows_loan_id_fkey on public.loan_schedule_rows is
  'Строки графика удаляются вместе с договором.';
comment on constraint loan_schedule_rows_paid_by_payment_id_fkey on public.loan_schedule_rows is
  'Удаление факта снимает каноническую связь; триггер возвращает строку в план.';
comment on constraint loan_schedule_rows_calendar_payment_id_fkey on public.loan_schedule_rows is
  'Удаление производного платежа не оставляет несуществующий идентификатор.';
