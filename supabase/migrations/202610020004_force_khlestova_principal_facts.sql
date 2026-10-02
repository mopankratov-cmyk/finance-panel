-- Точная корректировка фактов из загруженного помесячного графика.
-- Выбираем договор не только по сумме и дате, но и по номеру ИМ-2345-01:
-- в базе могут быть одноимённые записи, и LIMIT 1 для них небезопасен.

do $$
declare
  v_loan uuid;
  v_updated integer;
begin
  select l.id into v_loan
  from public.loans l
  where l.creditor = 'Хлестова Ольга Викторовна'
    and l.start_date = date '2023-06-22'
    and l.principal = 1500000
    and exists (
      select 1
      from public.payments p
      where coalesce(p.comment, '') like '%[loan:' || l.id::text || ':%'
        and coalesce(p.comment, '') like '%[contract-number:ИМ-2345-01]%'
    )
  limit 1;

  if v_loan is null then
    raise exception 'Не найден договор Хлестовой ИМ-2345-01';
  end if;

  update public.loan_schedule_rows
  set status = 'paid',
      updated_at = now()
  where loan_id = v_loan
    and kind = 'principal'
    and amount_rub = 100000
    and due_date in (date '2026-03-31', date '2026-05-31');

  get diagnostics v_updated = row_count;
  if v_updated <> 2 then
    raise exception 'Ожидались 2 строки тела по 100 000 ₽, обновлено: %', v_updated;
  end if;
end $$;
