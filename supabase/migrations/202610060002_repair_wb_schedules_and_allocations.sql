-- Два точечных исправления данных после неудачного восстановления 06.10.2026:
-- 1) вернуть полный хвост графика договора WB 2026020800236 из исходного PDF;
-- 2) пакетно зачесть старые удержания WB по договору 2025062500947.
-- Миграция идемпотентна: факты и уже закрытые строки не удаляются.

do $repair_wb_schedule$
declare
  v_loan uuid;
  v_loan_count integer;
  v_account uuid;
  v_company uuid;
begin
  with matched as (
    select distinct (regexp_match(p.comment, '\[loan:([0-9a-fA-F-]{36})'))[1]::uuid as loan_id
      from public.payments p
     where regexp_replace(coalesce((regexp_match(p.comment, '\[contract-number:([^\]]+)\]'))[1], ''), '\D', '', 'g') = '2026020800236'
  )
  select count(*), (array_agg(loan_id))[1]
    into v_loan_count, v_loan
    from matched;

  -- На старой карточке номер мог сохраниться только локально в браузере до
  -- первого открытия нового экрана. Дата, кредитор и сумма здесь однозначны.
  if v_loan_count = 0 then
    select count(*), (array_agg(id))[1]
      into v_loan_count, v_loan
      from public.loans
     where start_date = date '2026-02-08'
       and principal = 1000000
       and lower(creditor) like '%вб финанс%';
  end if;

  if v_loan_count <> 1 or v_loan is null then
    raise exception 'Ожидался один договор 2026020800236, найдено %', v_loan_count;
  end if;

  select p.account_id, p.company_id
    into v_account, v_company
    from public.payments p
   where p.comment like '%[loan:' || v_loan::text || '%'
     and p.account_id is not null
   order by p.date, p.created_at
   limit 1;

  if v_account is null then
    raise exception 'Не найден счёт оплаты договора 2026020800236';
  end if;

  create temporary table tmp_wb_schedule_source (
    due_date date primary key,
    principal numeric not null,
    interest numeric not null,
    balance_before numeric not null,
    balance_after numeric not null
  ) on commit drop;

  insert into tmp_wb_schedule_source values
    (date '2026-07-06', 10557.99, 6499.12, 806863.22, 796305.23),
    (date '2026-07-13', 10643.03, 6414.08, 796305.23, 785662.20),
    (date '2026-07-20', 10728.76, 6328.35, 785662.20, 774933.44),
    (date '2026-07-27', 10815.18, 6241.93, 774933.44, 764118.26),
    (date '2026-08-03', 10902.29, 6154.82, 764118.26, 753215.97),
    (date '2026-08-10', 10990.11, 6067.00, 753215.97, 742225.86),
    (date '2026-08-17', 11078.63, 5978.48, 742225.86, 731147.23),
    (date '2026-08-24', 11167.87, 5889.24, 731147.23, 719979.36),
    (date '2026-08-31', 11257.82, 5799.29, 719979.36, 708721.54),
    (date '2026-09-07', 11348.50, 5708.61, 708721.54, 697373.04),
    (date '2026-09-14', 11439.91, 5617.20, 697373.04, 685933.13),
    (date '2026-09-21', 11532.06, 5525.05, 685933.13, 674401.07),
    (date '2026-09-28', 11624.95, 5432.16, 674401.07, 662776.12),
    (date '2026-10-05', 12010.57, 5046.54, 662776.12, 650765.55),
    (date '2026-10-12', 12818.75, 4238.36, 650765.55, 637946.80),
    (date '2026-10-19', 12902.24, 4154.87, 637946.80, 625044.56),
    (date '2026-10-26', 12986.27, 4070.84, 625044.56, 612058.29),
    (date '2026-11-02', 13070.85, 3986.26, 612058.29, 598987.44),
    (date '2026-11-09', 13155.98, 3901.13, 598987.44, 585831.46),
    (date '2026-11-16', 13241.66, 3815.45, 585831.46, 572589.80),
    (date '2026-11-23', 13327.90, 3729.21, 572589.80, 559261.90),
    (date '2026-11-30', 13414.71, 3642.40, 559261.90, 545847.19),
    (date '2026-12-07', 13502.07, 3555.04, 545847.19, 532345.12),
    (date '2026-12-14', 13590.01, 3467.10, 532345.12, 518755.11),
    (date '2026-12-21', 13678.52, 3378.59, 518755.11, 505076.59),
    (date '2026-12-28', 13767.61, 3289.50, 505076.59, 491308.98),
    (date '2027-01-04', 13857.28, 3199.83, 491308.98, 477451.70),
    (date '2027-01-11', 13947.53, 3109.58, 477451.70, 463504.17),
    (date '2027-01-18', 14038.36, 3018.75, 463504.17, 449465.81),
    (date '2027-01-25', 14129.79, 2927.32, 449465.81, 435336.02),
    (date '2027-02-01', 14221.82, 2835.29, 435336.02, 421114.20),
    (date '2027-02-08', 14314.45, 2742.66, 421114.20, 406799.75),
    (date '2027-02-15', 14407.67, 2649.44, 406799.75, 392392.08),
    (date '2027-02-22', 14501.51, 2555.60, 392392.08, 377890.57),
    (date '2027-03-01', 14595.96, 2461.15, 377890.57, 363294.61),
    (date '2027-03-08', 14691.02, 2366.09, 363294.61, 348603.59),
    (date '2027-03-15', 14786.70, 2270.41, 348603.59, 333816.89),
    (date '2027-03-22', 14883.00, 2174.11, 333816.89, 318933.89),
    (date '2027-03-29', 14979.93, 2077.18, 318933.89, 303953.96),
    (date '2027-04-05', 15077.50, 1979.61, 303953.96, 288876.46),
    (date '2027-04-12', 15175.69, 1881.42, 288876.46, 273700.77),
    (date '2027-04-19', 15274.53, 1782.58, 273700.77, 258426.24),
    (date '2027-04-26', 15374.01, 1683.10, 258426.24, 243052.23),
    (date '2027-05-03', 15474.14, 1582.97, 243052.23, 227578.09),
    (date '2027-05-10', 15574.92, 1482.19, 227578.09, 212003.17),
    (date '2027-05-17', 15676.36, 1380.75, 212003.17, 196326.81),
    (date '2027-05-24', 15778.46, 1278.65, 196326.81, 180548.35),
    (date '2027-05-31', 15881.22, 1175.89, 180548.35, 164667.13),
    (date '2027-06-07', 15984.65, 1072.46, 164667.13, 148682.48),
    (date '2027-06-14', 16088.76, 968.35, 148682.48, 132593.72),
    (date '2027-06-21', 16193.54, 863.57, 132593.72, 116400.18),
    (date '2027-06-28', 16299.01, 758.10, 116400.18, 100101.17),
    (date '2027-07-05', 16405.16, 651.95, 100101.17, 83696.01),
    (date '2027-07-12', 16512.01, 545.10, 83696.01, 67184.00),
    (date '2027-07-19', 16619.55, 437.56, 67184.00, 50564.45),
    (date '2027-07-26', 16727.79, 329.32, 50564.45, 33836.66),
    (date '2027-08-02', 16836.74, 220.37, 33836.66, 16999.92),
    (date '2027-08-09', 16999.92, 110.70, 16999.92, 0.00);

  -- Удаляем только производный незакрытый хвост. Факты WB/ДДС и пеня
  -- 03.08.2026 остаются нетронутыми.
  delete from public.payments p
   using public.loan_schedule_rows r
   where r.loan_id = v_loan
     and r.due_date >= date '2026-07-06'
     and r.status = 'planned'
     and not exists (
       select 1 from public.loan_schedule_marketplace_allocations allocation
        where allocation.schedule_row_id = r.id
     )
     and p.id = r.calendar_payment_id;

  delete from public.loan_schedule_rows r
   where r.loan_id = v_loan
     and r.due_date >= date '2026-07-06'
     and r.status = 'planned'
     and not exists (
       select 1 from public.loan_schedule_marketplace_allocations allocation
        where allocation.schedule_row_id = r.id
     );

  create temporary table tmp_wb_schedule_rows on commit drop as
  select gen_random_uuid() as row_id, gen_random_uuid() as payment_id,
         source.due_date, kind.kind, kind.amount_rub,
         source.balance_before, source.balance_after
    from tmp_wb_schedule_source source
    cross join lateral (values
      ('principal'::text, source.principal),
      ('interest'::text, source.interest)
    ) kind(kind, amount_rub);

  insert into public.payments
    (id, name, amount, type, category, account_id, company_id, date, status, counterparty, comment)
  select desired.payment_id,
         case desired.kind when 'principal' then 'Погашение тела — ООО МКК «ВБ Финанс»' else 'Проценты по кредиту — ООО МКК «ВБ Финанс»' end,
         -desired.amount_rub, 'expense',
         case desired.kind when 'principal' then 'Погашение тела кредита' else 'Проценты по кредитам и займам' end,
         v_account, v_company, desired.due_date, 'planned', 'ООО МКК «ВБ Финанс»',
         '[loan:' || v_loan::text || ':schedule:' || desired.row_id::text || ':' || desired.kind || '] [currency:RUB] [fx-rate:1] [amount-original:' || desired.amount_rub::text || '] [amount-currency:RUB] [contract-number:2026020800236]'
    from tmp_wb_schedule_rows desired
   where not exists (
     select 1 from public.loan_schedule_rows existing
      where existing.loan_id = v_loan
        and existing.due_date = desired.due_date
        and existing.kind = desired.kind
   );

  insert into public.loan_schedule_rows
    (id, loan_id, due_date, kind, amount_rub, amount_original, currency, status,
     calendar_payment_id, balance_before, balance_after)
  select desired.row_id, v_loan, desired.due_date, desired.kind, desired.amount_rub,
         desired.amount_rub, 'RUB', 'planned', desired.payment_id,
         desired.balance_before, desired.balance_after
    from tmp_wb_schedule_rows desired
   where not exists (
     select 1 from public.loan_schedule_rows existing
      where existing.loan_id = v_loan
        and existing.due_date = desired.due_date
        and existing.kind = desired.kind
   );

  update public.loans set due_date = date '2027-08-09' where id = v_loan;
end
$repair_wb_schedule$;

do $allocate_old_wb_facts$
declare
  v_contract constant text := '2025062500947';
  v_loan uuid;
  v_fact record;
  v_row record;
  v_remaining numeric;
  v_row_remaining numeric;
  v_amount numeric;
  v_new_row uuid;
  v_unresolved integer;
begin
  select loan_id into v_loan
    from public.loan_marketplace_contract_links
   where marketplace = 'wb'
     and regexp_replace(contract_number, '\D', '', 'g') = v_contract;

  if v_loan is null then
    raise exception 'Не найден связанный договор WB %', v_contract;
  end if;

  for v_fact in
    select r.rr_dt::date as fact_date,
           abs(r.deduction::numeric) as amount_rub,
           'wb:' || r.cabinet_id::text || ':' || r.rrd_id::text as source,
           case
             when lower(r.bonus_type_name) like '%основного долга%' then 'principal'
             when lower(r.bonus_type_name) like '%процент%' then 'interest'
             when lower(r.bonus_type_name) like '%пени%' then 'penalty'
             when lower(r.bonus_type_name) like '%комисси%' then 'fee'
           end as kind
      from public.wb_report_rows r
     where r.supplier_oper_name = 'Удержание'
       and r.bonus_type_name ilike 'Перевод на баланс заёмщика%'
       and r.bonus_type_name like '%' || v_contract || '%'
     order by r.rr_dt, r.rrd_id
  loop
    if v_fact.kind is null then
      continue;
    end if;

    select greatest(0, v_fact.amount_rub - coalesce(sum(a.amount_rub), 0))
      into v_remaining
      from public.loan_schedule_marketplace_allocations a
     where a.marketplace_source = v_fact.source;

    for v_row in
      select row.id, row.amount_rub, row.calendar_payment_id
        from public.loan_schedule_rows row
       where row.loan_id = v_loan
         and row.kind = v_fact.kind
         and row.status = 'planned'
       order by case when row.due_date <= v_fact.fact_date then 0 else 1 end,
                row.due_date, row.created_at, row.id
    loop
      exit when v_remaining <= 0.01;
      select greatest(0, v_row.amount_rub - coalesce(sum(a.amount_rub), 0))
        into v_row_remaining
        from public.loan_schedule_marketplace_allocations a
       where a.schedule_row_id = v_row.id;
      if v_row_remaining <= 0.01 then
        continue;
      end if;

      v_amount := least(v_remaining, v_row_remaining);
      insert into public.loan_schedule_marketplace_allocations
        (schedule_row_id, marketplace_source, amount_rub)
      values (v_row.id, v_fact.source, v_amount)
      on conflict (schedule_row_id, marketplace_source) do update
        set amount_rub = public.loan_schedule_marketplace_allocations.amount_rub + excluded.amount_rub;
      v_remaining := v_remaining - v_amount;

      if v_amount + 0.01 >= v_row_remaining then
        update public.loan_schedule_rows
           set status = 'paid', paid_by_marketplace_source = v_fact.source, updated_at = now()
         where id = v_row.id;
        update public.payments
           set status = 'cancelled',
               comment = regexp_replace(coalesce(comment, ''), '\s*\[paid-by-marketplace:[^\]]+\]', '', 'g')
                         || ' [paid-by-marketplace:' || v_fact.source || ']'
         where id = v_row.calendar_payment_id;
      end if;
    end loop;

    if v_remaining > 0.01 then
      insert into public.loan_schedule_rows
        (loan_id, due_date, original_due_date, kind, amount_rub, amount_original,
         currency, status, paid_by_marketplace_source)
      values
        (v_loan, v_fact.fact_date, v_fact.fact_date, v_fact.kind, v_remaining,
         v_remaining, 'RUB', 'paid', v_fact.source)
      returning id into v_new_row;

      insert into public.loan_schedule_marketplace_allocations
        (schedule_row_id, marketplace_source, amount_rub)
      values (v_new_row, v_fact.source, v_remaining);
    end if;
  end loop;

  select count(*) into v_unresolved
    from public.wb_report_rows r
   where r.supplier_oper_name = 'Удержание'
     and r.bonus_type_name ilike 'Перевод на баланс заёмщика%'
     and r.bonus_type_name like '%' || v_contract || '%'
     and abs(r.deduction::numeric) > coalesce((
       select sum(a.amount_rub)
         from public.loan_schedule_marketplace_allocations a
        where a.marketplace_source = 'wb:' || r.cabinet_id::text || ':' || r.rrd_id::text
     ), 0) + 0.01;

  if v_unresolved <> 0 then
    raise exception 'После распределения договора % осталось удержаний: %', v_contract, v_unresolved;
  end if;
end
$allocate_old_wb_facts$;
