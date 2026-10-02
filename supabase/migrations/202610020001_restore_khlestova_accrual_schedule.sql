-- Исправляет единственный ошибочный импорт помесячного графика Хлестовой.
-- Ранний импорт записал «Погашено процентов» как начисление и поэтому потерял
-- июль–сентябрь. Фактические записи ДДС не удаляются: удаляются только
-- производные плановые платежи, которые ещё не были исполнены.

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

  -- Убираем только будущие производные планы ошибочного импорта. Оплаченные
  -- платежи ДДС остаются фактами, даже если их старая строка графика удаляется.
  delete from public.payments p
  using public.loan_schedule_rows r
  where r.loan_id = v_loan
    and r.due_date >= date '2026-02-28'
    and r.status = 'planned'
    and p.id = r.calendar_payment_id;

  delete from public.loan_schedule_rows
  where loan_id = v_loan
    and due_date >= date '2026-02-28';

  insert into public.loan_schedule_rows
    (loan_id, due_date, kind, amount_rub, amount_original, currency, status, balance_before, balance_after)
  values
    (v_loan, date '2026-02-28', 'interest', 69041.10, 69041.10, 'RUB', 'planned', 1000000, 1000000),
    (v_loan, date '2026-03-31', 'interest', 60164.38, 60164.38, 'RUB', 'planned', 1000000, 900000),
    (v_loan, date '2026-03-31', 'principal', 100000.00, 100000.00, 'RUB', 'paid', 1000000, 900000),
    (v_loan, date '2026-04-30', 'interest', 53260.27, 53260.27, 'RUB', 'planned', 900000, 900000),
    (v_loan, date '2026-05-31', 'interest', 49906.85, 49906.85, 'RUB', 'planned', 900000, 800000),
    (v_loan, date '2026-05-31', 'principal', 100000.00, 100000.00, 'RUB', 'paid', 900000, 800000),
    (v_loan, date '2026-06-30', 'interest', 47342.47, 47342.47, 'RUB', 'planned', 800000, 800000),
    (v_loan, date '2026-07-31', 'interest', 48920.55, 48920.55, 'RUB', 'planned', 800000, 800000),
    (v_loan, date '2026-08-31', 'interest', 48920.55, 48920.55, 'RUB', 'planned', 800000, 800000),
    (v_loan, date '2026-09-30', 'interest', 47342.47, 47342.47, 'RUB', 'planned', 800000, 800000),
    (v_loan, date '2026-10-31', 'interest', 48920.55, 48920.55, 'RUB', 'planned', 800000, 800000),
    (v_loan, date '2026-11-26', 'interest', 29063.01, 29063.01, 'RUB', 'planned', 800000, 0),
    (v_loan, date '2026-11-26', 'principal', 800000.00, 800000.00, 'RUB', 'planned', 800000, 0);
end $$;
