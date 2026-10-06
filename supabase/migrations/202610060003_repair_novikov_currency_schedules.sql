-- Восстановить два валютных договора Новикова из исходных DOCX.
-- Суммы в USD сохраняются в amount_original, рублёвый эквивалент каждой
-- строки рассчитан по официальному курсу ЦБ РФ, действовавшему в её дату.
-- Уже закрытые строки и их связи с фактами не удаляются.

do $repair_novikov_currency_schedules$
declare
  v_loan_22 uuid;
  v_loan_36 uuid;
  v_count integer;
  v_loan uuid;
  v_account uuid;
  v_company uuid;
  v_creditor text;
begin
  select count(*), (array_agg(id))[1]
    into v_count, v_loan_22
    from public.loans
   where start_date = date '2025-10-30'
     and due_date = date '2026-10-30'
     and lower(creditor) like '%новиков валерий михайлович%';
  if v_count <> 1 then
    raise exception 'Ожидался один договор Новикова 30.10.2025, найдено %', v_count;
  end if;

  select count(*), (array_agg(id))[1]
    into v_count, v_loan_36
    from public.loans
   where start_date = date '2025-09-25'
     and due_date = date '2026-09-25'
     and lower(creditor) like '%новиков валерий михайлович%';
  if v_count <> 1 then
    raise exception 'Ожидался один договор Новикова 25.09.2025, найдено %', v_count;
  end if;

  create temporary table tmp_novikov_schedule (
    loan_id uuid not null,
    due_date date not null,
    kind text not null,
    amount_original numeric not null,
    cbr_rate numeric not null,
    balance_before_original numeric,
    balance_after_original numeric,
    primary key (loan_id, due_date, kind)
  ) on commit drop;

  -- 22 000 USD: точные проценты и даты напечатаны в таблице договора.
  insert into tmp_novikov_schedule values
    (v_loan_22, date '2025-10-31', 'interest', 21.10, 80.5037, 22000, 22000),
    (v_loan_22, date '2025-11-30', 'interest', 632.88, 78.2284, 22000, 22000),
    (v_loan_22, date '2025-12-31', 'interest', 653.97, 78.2267, 22000, 22000),
    (v_loan_22, date '2026-01-31', 'interest', 653.97, 75.7327, 22000, 22000),
    (v_loan_22, date '2026-02-28', 'interest', 590.68, 77.2736, 22000, 22000),
    (v_loan_22, date '2026-03-31', 'interest', 653.97, 81.2955, 22000, 22000),
    (v_loan_22, date '2026-04-30', 'interest', 632.88, 74.8806, 22000, 22000),
    (v_loan_22, date '2026-05-31', 'interest', 653.97, 71.0224, 22000, 22000),
    (v_loan_22, date '2026-06-30', 'interest', 632.88, 77.7539, 22000, 22000),
    (v_loan_22, date '2026-07-31', 'interest', 653.97, 79.8573, 22000, 22000),
    (v_loan_22, date '2026-08-31', 'interest', 653.97, 85.6007, 22000, 22000),
    (v_loan_22, date '2026-09-30', 'interest', 632.88, 84.4283, 22000, 22000),
    (v_loan_22, date '2026-10-30', 'interest', 632.88, 85.7116, 22000, 22000),
    (v_loan_22, date '2026-10-30', 'principal', 22000, 85.7116, 22000, 0);

  -- 36 000 USD: в договоре зафиксированы ежемесячные 1 050 USD. Сохраняем
  -- установленный в карточке день платежа (10-е), но возвращаем июль и август
  -- отдельными строками вместо сложенных 2 102 USD в сентябре.
  insert into tmp_novikov_schedule values
    (v_loan_36, date '2025-10-10', 'interest', 1050, 81.4103, 36000, 36000),
    (v_loan_36, date '2025-11-10', 'interest', 1050, 81.2257, 36000, 36000),
    (v_loan_36, date '2025-12-10', 'interest', 1050, 76.8084, 36000, 36000),
    (v_loan_36, date '2026-01-10', 'interest', 1050, 78.2267, 36000, 36000),
    (v_loan_36, date '2026-02-10', 'interest', 1050, 77.6502, 36000, 36000),
    (v_loan_36, date '2026-03-10', 'interest', 1050, 79.1500, 36000, 36000),
    (v_loan_36, date '2026-04-10', 'interest', 1050, 77.8366, 36000, 36000),
    (v_loan_36, date '2026-05-10', 'interest', 1050, 74.2963, 36000, 36000),
    (v_loan_36, date '2026-06-10', 'interest', 1050, 71.7318, 36000, 36000),
    (v_loan_36, date '2026-07-10', 'interest', 1050, 75.9300, 36000, 36000),
    (v_loan_36, date '2026-08-10', 'interest', 1050, 82.1665, 36000, 36000),
    (v_loan_36, date '2026-09-10', 'interest', 1050, 85.4594, 36000, 36000),
    (v_loan_36, date '2026-09-25', 'principal', 36000, 84.9057, 36000, 0);

  -- Удаляем только ошибочные производные планы (в том числе 02.09 на 2 102 USD).
  -- Факты и закрытые строки остаются в истории.
  delete from public.payments p
   using public.loan_schedule_rows r
   where r.loan_id in (v_loan_22, v_loan_36)
     and r.status = 'planned'
     and not exists (
       select 1 from tmp_novikov_schedule desired
        where desired.loan_id = r.loan_id
          and desired.due_date = r.due_date
          and desired.kind = r.kind
     )
     and p.id = r.calendar_payment_id;

  delete from public.loan_schedule_rows r
   where r.loan_id in (v_loan_22, v_loan_36)
     and r.status = 'planned'
     and not exists (
       select 1 from tmp_novikov_schedule desired
        where desired.loan_id = r.loan_id
          and desired.due_date = r.due_date
          and desired.kind = r.kind
     );

  -- Исправляем существующие строки, включая уже оплаченные: меняется только
  -- договорная сумма/курс, связь с фактом и статус сохраняются.
  update public.loan_schedule_rows row
     set amount_original = desired.amount_original,
         amount_rub = round(desired.amount_original * desired.cbr_rate, 2),
         currency = 'USD',
         balance_before = case when desired.balance_before_original is null then null else round(desired.balance_before_original * desired.cbr_rate, 2) end,
         balance_after = case when desired.balance_after_original is null then null else round(desired.balance_after_original * desired.cbr_rate, 2) end,
         updated_at = now()
    from tmp_novikov_schedule desired
   where row.loan_id = desired.loan_id
     and row.due_date = desired.due_date
     and row.kind = desired.kind;

  update public.payments payment
     set amount = -round(desired.amount_original * desired.cbr_rate, 2),
         date = desired.due_date,
         comment = trim(regexp_replace(coalesce(payment.comment, ''), '\s*\[(currency|fx-rate|fx-rate-current|fx-rate-date|amount-original|amount-currency):[^\]]*\]', '', 'g'))
                   || ' [currency:USD] [fx-rate:' || desired.cbr_rate::text || '] [fx-rate-date:' || desired.due_date::text || '] [amount-original:' || desired.amount_original::text || '] [amount-currency:USD]'
    from public.loan_schedule_rows row
    join tmp_novikov_schedule desired
      on desired.loan_id = row.loan_id
     and desired.due_date = row.due_date
     and desired.kind = row.kind
   where payment.id = row.calendar_payment_id;

  -- Добавляем отсутствующие месяцы и тело с тем же счётом/компанией, что уже
  -- используются карточкой договора.
  for v_loan in select unnest(array[v_loan_22, v_loan_36])
  loop
    select p.account_id, p.company_id, l.creditor
      into v_account, v_company, v_creditor
      from public.loans l
      left join lateral (
        select payment.account_id, payment.company_id
          from public.payments payment
         where payment.comment like '%[loan:' || l.id::text || ':%'
           and payment.account_id is not null
         order by payment.date, payment.created_at
         limit 1
      ) p on true
     where l.id = v_loan;
    if v_account is null then
      raise exception 'Не найден счёт платежей договора Новикова %', v_loan;
    end if;

    create temporary table tmp_novikov_missing on commit drop as
    select gen_random_uuid() row_id, gen_random_uuid() payment_id, desired.*
      from tmp_novikov_schedule desired
     where desired.loan_id = v_loan
       and not exists (
         select 1 from public.loan_schedule_rows existing
          where existing.loan_id = desired.loan_id
            and existing.due_date = desired.due_date
            and existing.kind = desired.kind
       );

    insert into public.payments
      (id, name, amount, type, category, account_id, company_id, date, status, counterparty, comment)
    select missing.payment_id,
           case missing.kind when 'principal' then 'Погашение тела — ' || v_creditor else 'Проценты по кредиту — ' || v_creditor end,
           -round(missing.amount_original * missing.cbr_rate, 2), 'expense',
           case missing.kind when 'principal' then 'Погашение тела кредита' else 'Проценты по кредитам и займам' end,
           v_account, v_company, missing.due_date, 'planned', v_creditor,
           '[loan:' || v_loan::text || ':schedule:' || missing.row_id::text || ':' || missing.kind || ']'
           || ' [currency:USD] [fx-rate:' || missing.cbr_rate::text || '] [fx-rate-date:' || missing.due_date::text || ']'
           || ' [amount-original:' || missing.amount_original::text || '] [amount-currency:USD]'
      from tmp_novikov_missing missing;

    insert into public.loan_schedule_rows
      (id, loan_id, due_date, kind, amount_rub, amount_original, currency, status,
       calendar_payment_id, balance_before, balance_after)
    select missing.row_id, missing.loan_id, missing.due_date, missing.kind,
           round(missing.amount_original * missing.cbr_rate, 2), missing.amount_original,
           'USD', 'planned', missing.payment_id,
           round(missing.balance_before_original * missing.cbr_rate, 2),
           round(missing.balance_after_original * missing.cbr_rate, 2)
      from tmp_novikov_missing missing;

    drop table tmp_novikov_missing;
  end loop;

  -- Сумма договора фиксируется по курсу ЦБ в день выдачи, а не по одному
  -- случайному курсу, которым раньше пересчитали весь график.
  update public.loans set principal = round(22000 * 79.4715, 2), annual_rate = 35,
    interest_frequency = 'monthly' where id = v_loan_22;
  update public.loans set principal = round(36000 * 83.9914, 2), annual_rate = 35,
    interest_frequency = 'monthly' where id = v_loan_36;
end
$repair_novikov_currency_schedules$;
