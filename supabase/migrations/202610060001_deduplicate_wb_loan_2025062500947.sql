-- Договор WB 2025062500947 был импортирован пять раз. Оставляем запись,
-- которая уже выбрана в сверке WB, а связанные данные переносим атомарно.
-- Защитные проверки не дают применить миграцию к другому набору данных.

do $deduplicate_wb_loan$
declare
  v_contract constant text := '2025062500947';
  v_canonical uuid;
  v_count integer;
  v_duplicate uuid;
begin
  select loan_id
    into v_canonical
    from public.loan_marketplace_contract_links
   where marketplace = 'wb'
     and regexp_replace(contract_number, '\D', '', 'g') = v_contract;

  if v_canonical is null then
    raise exception 'Сначала свяжите договор WB % с договором панели', v_contract;
  end if;

  create temporary table tmp_wb_duplicate_loans (
    loan_id uuid primary key
  ) on commit drop;

  insert into tmp_wb_duplicate_loans (loan_id)
  select distinct (regexp_match(p.comment, '\[loan:([0-9a-fA-F-]{36})'))[1]::uuid
    from public.payments p
   where regexp_replace(coalesce((regexp_match(p.comment, '\[contract-number:([^\]]+)\]'))[1], ''), '\D', '', 'g') = v_contract
     and exists (
       select 1
         from public.loans l
        where l.id = (regexp_match(p.comment, '\[loan:([0-9a-fA-F-]{36})'))[1]::uuid
     );

  select count(*) into v_count from tmp_wb_duplicate_loans;
  if v_count <> 5 then
    raise exception 'Ожидалось 5 записей договора %, найдено %. Изменения отменены', v_contract, v_count;
  end if;
  if not exists (select 1 from tmp_wb_duplicate_loans where loan_id = v_canonical) then
    raise exception 'Связанный договор % не входит в найденную пятёрку. Изменения отменены', v_canonical;
  end if;

  create temporary table tmp_wb_row_map (
    source_id uuid primary key,
    target_id uuid not null,
    calendar_payment_id uuid
  ) on commit drop;

  -- Одинаковая дата и вид платежа означают одну строку одного и того же
  -- графика. Фактические распределения переносим на каноническую строку.
  insert into tmp_wb_row_map (source_id, target_id, calendar_payment_id)
  select source.id, target.id, source.calendar_payment_id
    from public.loan_schedule_rows source
    join tmp_wb_duplicate_loans duplicate on duplicate.loan_id = source.loan_id
    join lateral (
      select canonical.id
        from public.loan_schedule_rows canonical
       where canonical.loan_id = v_canonical
         and canonical.due_date = source.due_date
         and canonical.kind = source.kind
       order by (canonical.status = 'paid') desc, canonical.created_at, canonical.id
       limit 1
    ) target on true
   where source.loan_id <> v_canonical;

  insert into public.loan_schedule_marketplace_allocations
    (schedule_row_id, marketplace_source, amount_rub, created_at)
  select mapping.target_id, allocation.marketplace_source, max(allocation.amount_rub), min(allocation.created_at)
    from public.loan_schedule_marketplace_allocations allocation
    join tmp_wb_row_map mapping on mapping.source_id = allocation.schedule_row_id
   group by mapping.target_id, allocation.marketplace_source
  on conflict (schedule_row_id, marketplace_source) do update
    set amount_rub = greatest(public.loan_schedule_marketplace_allocations.amount_rub, excluded.amount_rub);

  update public.loan_schedule_rows target
     set status = case when source.status = 'paid' then 'paid' else target.status end,
         paid_by_payment_id = coalesce(target.paid_by_payment_id, source.paid_by_payment_id),
         paid_by_marketplace_source = coalesce(target.paid_by_marketplace_source, source.paid_by_marketplace_source),
         updated_at = now()
    from tmp_wb_row_map mapping
    join public.loan_schedule_rows source on source.id = mapping.source_id
   where target.id = mapping.target_id;

  delete from public.loan_schedule_rows row
   using tmp_wb_row_map mapping
   where row.id = mapping.source_id;

  -- Если в одном из дублей была уникальная фактическая строка, которой ещё
  -- нет в каноническом графике, сохраняем её вместо удаления.
  update public.loan_schedule_rows row
     set loan_id = v_canonical,
         updated_at = now()
   where row.loan_id in (select loan_id from tmp_wb_duplicate_loans where loan_id <> v_canonical);

  -- Документы остаются доступны в единственной карточке договора.
  update public.finance_loan_documents
     set loan_id = v_canonical::text
   where loan_id in (select loan_id::text from tmp_wb_duplicate_loans where loan_id <> v_canonical);

  update public.loan_marketplace_contract_links
     set loan_id = v_canonical,
         updated_at = now()
   where marketplace = 'wb'
     and regexp_replace(contract_number, '\D', '', 'g') = v_contract;

  -- Комментарии — часть связи кредита с ДДС. Локальный флаг разрешает
  -- атомарную замену даже для платежей, входящих в цепочки.
  perform set_config('finance.chain_edit', 'on', true);
  for v_duplicate in
    select loan_id from tmp_wb_duplicate_loans where loan_id <> v_canonical
  loop
    -- У каждого ошибочного дубля есть собственный плановый приход кредита.
    -- Это не банковский факт, а производная строка карточки договора.
    delete from public.payments
     where comment like '%[loan:' || v_duplicate::text || ':receipt]%';

    update public.payments
       set comment = replace(comment, '[loan:' || v_duplicate::text, '[loan:' || v_canonical::text)
     where comment like '%[loan:' || v_duplicate::text || '%';

    update public.finance_payment_chains
       set draft = replace(draft::text, v_duplicate::text, v_canonical::text)::jsonb,
           updated_at = now()
     where draft::text like '%' || v_duplicate::text || '%';

    update public.finance_payment_chain_revisions
       set draft = replace(draft::text, v_duplicate::text, v_canonical::text)::jsonb
     where draft::text like '%' || v_duplicate::text || '%';
  end loop;

  -- Производные календарные строки уже представлены каноническим графиком.
  delete from public.payments payment
   using tmp_wb_row_map mapping
   where payment.id = mapping.calendar_payment_id
     and mapping.calendar_payment_id is not null;

  delete from public.loans loan
   where loan.id in (select loan_id from tmp_wb_duplicate_loans where loan_id <> v_canonical);
end
$deduplicate_wb_loan$;
