-- После восстановления графика связывает мартовское и майское погашения тела
-- с уже существующими фактами ДДС. Новых платежей не создаёт.

do $$
declare
  v_loan uuid;
begin
  select id into v_loan
  from public.loans
  where creditor = 'Хлестова Ольга Викторовна'
    and start_date = date '2023-06-22'
    and principal = 1500000
  limit 1;

  if v_loan is null then
    raise exception 'Не найден договор Хлестовой Ольги от 22.06.2023 на 1 500 000 ₽';
  end if;

  update public.loan_schedule_rows r
  set calendar_payment_id = p.id,
      paid_by_payment_id = p.id,
      updated_at = now()
  from public.payments p
  where r.loan_id = v_loan
    and r.kind = 'principal'
    and r.status = 'paid'
    and r.due_date in (date '2026-03-31', date '2026-05-31')
    and p.status = 'done'
    and p.date = r.due_date
    and abs(p.amount) = r.amount_rub
    and p.comment like ('%[loan:' || v_loan::text || ':schedule:%:principal]%');
end $$;
