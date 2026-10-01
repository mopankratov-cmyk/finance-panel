-- Исправляет только ранее заведённую вручную еженедельную серию Алексею Хлестову.
-- Фактические платежи ДДС и отдельные договоры Хлестовых не затрагиваются.
do $$
declare
  v_ids uuid[];
  v_interest_category text;
  v_principal_category text;
begin
  select array_agg(id order by date),
         max(category) filter (where abs(amount) = 30000),
         max(category) filter (where abs(amount) = 500000)
    into v_ids, v_interest_category, v_principal_category
  from public.payments
  where status = 'planned'
    and lower(coalesce(name, '')) like '%алексею хлестову%'
    and date in ('2026-10-02','2026-10-09','2026-10-16','2026-10-23','2026-10-30','2026-11-05','2026-11-12','2026-11-19','2026-11-26')
    and abs(amount) in (30000, 500000);

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise notice 'График Алексея Хлестова уже исправлен или исходная серия отсутствует';
    return;
  end if;
  if array_length(v_ids, 1) <> 9 then
    raise exception 'Ожидалось 9 исходных плановых платежей Алексею Хлестову, найдено %', array_length(v_ids, 1);
  end if;

  with target(ord, payment_date, payment_amount, payment_category) as (values
    (1, date '2026-10-01',  30000::numeric, v_interest_category),
    (2, date '2026-10-08',  30000::numeric, v_interest_category),
    (3, date '2026-10-15',  30000::numeric, v_interest_category),
    (4, date '2026-10-22',  30000::numeric, v_interest_category),
    (5, date '2026-10-29',  30000::numeric, v_interest_category),
    (6, date '2026-11-05', 375000::numeric, coalesce(v_principal_category, 'Оплаты по кредитам и займам')),
    (7, date '2026-11-12', 375000::numeric, coalesce(v_principal_category, 'Оплаты по кредитам и займам')),
    (8, date '2026-11-19', 375000::numeric, coalesce(v_principal_category, 'Оплаты по кредитам и займам')),
    (9, date '2026-11-26', 375000::numeric, coalesce(v_principal_category, 'Оплаты по кредитам и займам'))
  )
  update public.payments p
     set date = target.payment_date,
         amount = -target.payment_amount,
         category = target.payment_category
    from target
   where p.id = v_ids[target.ord];

  -- Телеграм-бот читает зеркало; если оно уже создано, обновляем те же строки.
  if to_regclass('public.finance_payments') is not null then
    with target(ord, payment_date, payment_amount, payment_category) as (values
      (1, date '2026-10-01',  30000::numeric, v_interest_category),
      (2, date '2026-10-08',  30000::numeric, v_interest_category),
      (3, date '2026-10-15',  30000::numeric, v_interest_category),
      (4, date '2026-10-22',  30000::numeric, v_interest_category),
      (5, date '2026-10-29',  30000::numeric, v_interest_category),
      (6, date '2026-11-05', 375000::numeric, coalesce(v_principal_category, 'Оплаты по кредитам и займам')),
      (7, date '2026-11-12', 375000::numeric, coalesce(v_principal_category, 'Оплаты по кредитам и займам')),
      (8, date '2026-11-19', 375000::numeric, coalesce(v_principal_category, 'Оплаты по кредитам и займам')),
      (9, date '2026-11-26', 375000::numeric, coalesce(v_principal_category, 'Оплаты по кредитам и займам'))
    )
    update public.finance_payments p
       set date = target.payment_date,
           amount = -target.payment_amount,
           category = target.payment_category,
           updated_at = now()
      from target
     where p.id = v_ids[target.ord];
  end if;
end $$;

notify pgrst, 'reload schema';
