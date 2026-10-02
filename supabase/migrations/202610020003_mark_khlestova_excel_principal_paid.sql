-- В загруженном пользователем графике Хлестовой явно указано фактическое
-- погашение тела: 100 000 ₽ в марте и 100 000 ₽ в мае 2026 года.
-- Отдельных фактов ДДС для них в базе нет, поэтому не создаём вымышленные
-- операции и не ставим связь paid_by_payment_id. Помечаем только строки
-- графика как оплаченные по первичному документу.

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

  update public.loan_schedule_rows
  set status = 'paid',
      updated_at = now()
  where loan_id = v_loan
    and kind = 'principal'
    and amount_rub = 100000
    and due_date in (date '2026-03-31', date '2026-05-31')
    and status = 'planned';
end $$;
