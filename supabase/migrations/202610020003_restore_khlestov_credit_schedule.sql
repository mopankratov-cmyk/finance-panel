-- Календарный план Алексею Хлестову меняется отдельно от графика договора.
-- Возвращаем договор ИМ-2345-02 к исходному графику и оставляем в календаре
-- исправленную ручную серию 30 000 / 375 000 рублей.
do $restore_khlestov$
declare
  v_loan_id text;
  v_loan_count integer;
  v_wrong_row_id uuid;
  v_wrong_payment_id uuid;
  v_manual_count integer;
begin
  select count(*), min(id::text)
    into v_loan_count, v_loan_id
  from public.loans
  where lower(coalesce(creditor, '')) like '%хлестов алексей%'
    and start_date = date '2023-07-07'
    and abs(principal - 1500000::numeric) < 0.01;

  if v_loan_count <> 1 then
    raise exception 'Ожидался один договор Хлестова ИМ-2345-02, найдено %', v_loan_count;
  end if;

  -- Единственная ошибочно добавленная строка графика: оплаченные проценты
  -- 21 сентября без связанного факта ДДС. Исторические строки не затрагиваем.
  select id, calendar_payment_id
    into v_wrong_row_id, v_wrong_payment_id
  from public.loan_schedule_rows
  where loan_id::text = v_loan_id
    and due_date = date '2026-09-21'
    and kind = 'interest'
    and abs(amount_rub - 30000::numeric) < 0.01
    and status = 'paid'
    and paid_by_payment_id is null
    and paid_by_marketplace_source is null
  limit 1;

  if v_wrong_row_id is not null then
    delete from public.loan_schedule_rows where id = v_wrong_row_id;
    delete from public.payments where id = v_wrong_payment_id;
  end if;

  update public.loans
     set due_date = date '2026-12-12'
   where id::text = v_loan_id;

  -- Старый договорный график остаётся в разделе кредитов, но его производные
  -- платежи не должны дублировать отдельный управленческий план в календаре.
  update public.payments p
     set status = 'cancelled'
   where p.id in (
     select r.calendar_payment_id
     from public.loan_schedule_rows r
     where r.loan_id::text = v_loan_id
       and r.status = 'planned'
       and r.due_date in (
         date '2026-06-12', date '2026-07-12', date '2026-08-12',
         date '2026-09-12', date '2026-10-12', date '2026-11-12',
         date '2026-12-12'
       )
       and r.calendar_payment_id is not null
   );

  select count(*)
    into v_manual_count
  from public.payments
  where lower(coalesce(name, '')) like '%алексею хлестову%'
    and date in (
      date '2026-10-01', date '2026-10-08', date '2026-10-15',
      date '2026-10-22', date '2026-10-29', date '2026-11-05',
      date '2026-11-12', date '2026-11-19', date '2026-11-26'
    )
    and abs(amount) = case
      when date < date '2026-11-01' then 30000::numeric
      else 375000::numeric
    end;

  if v_manual_count <> 9 then
    raise exception 'Ожидалось 9 строк отдельного плана Хлестова, найдено %', v_manual_count;
  end if;

  update public.payments
     set status = 'planned'
   where lower(coalesce(name, '')) like '%алексею хлестову%'
     and date in (
       date '2026-10-01', date '2026-10-08', date '2026-10-15',
       date '2026-10-22', date '2026-10-29', date '2026-11-05',
       date '2026-11-12', date '2026-11-19', date '2026-11-26'
     )
     and abs(amount) = case
       when date < date '2026-11-01' then 30000::numeric
       else 375000::numeric
     end;

  -- Возвращаем исходный статус поступлению займа 2023 года: эта запись была
  -- плановой до исправления календаря и не относится к факту ДДС.
  update public.payments
     set status = 'planned'
   where date = date '2023-07-07'
     and amount = 1500000::numeric
     and lower(coalesce(name, '')) like '%получение кредита%хлестов алексей%';

  -- Повторная загрузка исходного файла изменила только отображаемое имя.
  -- Возвращаем прежнее имя в метках договора и убираем дубликат из реестра.
  update public.payments
     set comment = regexp_replace(
       comment,
       '\\[contract:[^]]+\\]',
       '[contract:Договора_займа_Максим_Алексей.docx]',
       'g'
     )
   where position('[loan:' || v_loan_id || ':' in coalesce(comment, '')) > 0
     and coalesce(comment, '') ~ '\\[contract:';

  delete from public.finance_loan_documents
   where loan_id = v_loan_id
     and file_name = '220a1a7c-fb80-4fa8-9404-01e9bcd04cfe.docx';

  if to_regclass('public.finance_payments') is not null then
    if v_wrong_payment_id is not null then
      delete from public.finance_payments where id = v_wrong_payment_id::text;
    end if;

    update public.finance_payments
       set status = 'planned', updated_at = now()
     where lower(coalesce(name, '')) like '%алексею хлестову%'
       and date in (
         date '2026-10-01', date '2026-10-08', date '2026-10-15',
         date '2026-10-22', date '2026-10-29', date '2026-11-05',
         date '2026-11-12', date '2026-11-19', date '2026-11-26'
       )
       and abs(amount) = case
         when date < date '2026-11-01' then 30000::numeric
         else 375000::numeric
       end;

    update public.finance_payments
       set status = 'planned', updated_at = now()
     where date = date '2023-07-07'
       and amount = 1500000::numeric
       and lower(coalesce(name, '')) like '%получение кредита%хлестов алексей%';

    update public.finance_payments fp
       set status = 'cancelled', updated_at = now()
     where fp.id in (
       select r.calendar_payment_id::text
       from public.loan_schedule_rows r
       where r.loan_id::text = v_loan_id
         and r.status = 'planned'
         and r.due_date in (
           date '2026-06-12', date '2026-07-12', date '2026-08-12',
           date '2026-09-12', date '2026-10-12', date '2026-11-12',
           date '2026-12-12'
         )
         and r.calendar_payment_id is not null
     );

    update public.finance_payments
       set comment = regexp_replace(
         comment,
         '\\[contract:[^]]+\\]',
         '[contract:Договора_займа_Максим_Алексей.docx]',
         'g'
       ), updated_at = now()
     where position('[loan:' || v_loan_id || ':' in coalesce(comment, '')) > 0
       and coalesce(comment, '') ~ '\\[contract:';
  end if;
end
$restore_khlestov$;

notify pgrst, 'reload schema';
