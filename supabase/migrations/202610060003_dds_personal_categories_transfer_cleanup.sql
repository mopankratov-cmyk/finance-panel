-- Исправляет уже загруженные карточные операции и доводит найденные
-- межсчётные переводы до двух фактов ДДС.

-- Два разных счёта одного владельца подтверждают внутренний перевод даже
-- тогда, когда банк не передал счёт контрагента. Явно переданный встречный
-- счёт по-прежнему имеет приоритет и обязан совпасть.
create or replace function public.link_bank_review_transfer(
  p_outgoing uuid,
  p_incoming uuid,
  p_outgoing_category text,
  p_incoming_category text
) returns boolean
language plpgsql security definer set search_path=public as $$
declare
  o public.bank_review_items%rowtype;
  i public.bank_review_items%rowtype;
  oa text;
  ia text;
  pair_id text;
  already_linked boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('bank-review-confirm-link',0));
  perform 1 from public.bank_review_items where id in (p_outgoing,p_incoming) order by id for update;
  select * into o from public.bank_review_items where id=p_outgoing;
  select * into i from public.bank_review_items where id=p_incoming;
  if o.id is null or i.id is null or o.status='rejected' or i.status='rejected' then
    raise exception 'Операции не найдены' using errcode='22023';
  end if;
  already_linked := o.matched_transfer_id=i.id and i.matched_transfer_id=o.id;
  if not already_linked and (o.matched_transfer_id is not null or i.matched_transfer_id is not null) then
    raise exception 'Операция уже связана с другим переводом' using errcode='40001';
  end if;
  if not already_linked then
    if o.amount>=0 or i.amount<=0 or round(o.amount,2)+round(i.amount,2)<>0 or abs(o.date-i.date)>3
       or nullif(o.bank_account_number,'') is null or nullif(i.bank_account_number,'') is null
       or o.bank_account_number=i.bank_account_number then
      raise exception 'Не сходятся сумма, даты или счета перевода' using errcode='22023';
    end if;
    select substring(value from length('__counterparty_account:')+1) into oa
      from jsonb_array_elements_text(to_jsonb(o.reasons)) value
      where value like '__counterparty_account:%' limit 1;
    select substring(value from length('__counterparty_account:')+1) into ia
      from jsonb_array_elements_text(to_jsonb(i.reasons)) value
      where value like '__counterparty_account:%' limit 1;
    if (nullif(oa,'') is not null and oa<>i.bank_account_number)
       or (nullif(ia,'') is not null and ia<>o.bank_account_number)
       or not (
         coalesce(oa=i.bank_account_number,false)
         or coalesce(ia=o.bank_account_number,false)
         or (nullif(o.owner_inn,'') is not null and o.owner_inn=i.owner_inn)
         or (nullif(o.counterparty_inn,'') is not null and o.counterparty_inn=i.owner_inn)
         or (nullif(i.counterparty_inn,'') is not null and i.counterparty_inn=o.owner_inn)
       ) then
      raise exception 'Реквизиты не подтверждают перевод между этими счетами' using errcode='22023';
    end if;
  end if;

  update public.bank_review_items
  set matched_transfer_id=case when id=o.id then i.id else o.id end,
      category=case when id=o.id then p_outgoing_category else p_incoming_category end,
      status=case
        when status='approved' then status
        when company_id is not null and account_id is not null then 'ready'
        else 'needs_info'
      end,
      updated_at=now()
  where id in(o.id,i.id);

  pair_id:=least(o.id::text,i.id::text);
  update public.payments
  set category=case
        when import_source='bank-review:'||o.id::text then p_outgoing_category
        else p_incoming_category
      end,
      comment=case
        when position('[dds-bank-transfer:'||pair_id||']' in coalesce(comment,''))=0
          then coalesce(comment,'')||' [dds-bank-transfer:'||pair_id||']'
        else comment
      end
  where import_source in ('bank-review:'||o.id::text,'bank-review:'||i.id::text)
    and status='done';
  return true;
end; $$;

revoke all on function public.link_bank_review_transfer(uuid,uuid,text,text) from public;
grant execute on function public.link_bank_review_transfer(uuid,uuid,text,text) to service_role;

-- Yandex, отдых, супермаркеты, рестораны и кафе — личные расходы владельца.
update public.bank_review_items r
set category = 'Дивиденды',
    confidence = greatest(coalesce(r.confidence, 0), 0.98),
    reasons = coalesce(r.reasons, '[]'::jsonb) || jsonb_build_array('__rule:personal-expense-dividends'),
    updated_at = now()
where r.amount < 0
  and r.status <> 'rejected'
  and lower(coalesce(r.counterparty, '') || ' ' || coalesce(r.purpose, ''))
      ~ '(^|[^a-zа-я])(yandex|отдых и развлечения|супермаркет[а-я]*|ресторан[а-я]* и кафе)($|[^a-zа-я])';

update public.payments p
set category = 'Дивиденды'
where p.status = 'done'
  and p.amount < 0
  and lower(coalesce(p.counterparty, '') || ' ' || coalesce(p.name, ''))
      ~ '(^|[^a-zа-я])(yandex|отдых и развлечения|супермаркет[а-я]*|ресторан[а-я]* и кафе)($|[^a-zа-я])';

-- 5 100 ₽ — перевод, в сумму которого включена комиссия 100 ₽. Весь платёж
-- не является РКО; до нахождения второй стороны оставляем его без статьи.
update public.bank_review_items r
set category = 'Пока без статьи', confidence = 0,
    reasons = coalesce(r.reasons, '[]'::jsonb) || jsonb_build_array('__rule:transfer-with-included-commission'),
    updated_at = now()
where r.date = date '2026-09-23'
  and round(r.amount::numeric, 2) = -5100.00
  and lower(coalesce(r.purpose, '')) ~ 'перевод с карты'
  and lower(coalesce(r.purpose, '')) ~ 'в сумму операции включен[а-я]* комиссия';

update public.payments p
set category = 'Пока без статьи'
where p.status = 'done'
  and p.date = date '2026-09-23'
  and round(p.amount::numeric, 2) = -5100.00
  and lower(coalesce(p.name, '')) ~ 'перевод с карты'
  and lower(coalesce(p.name, '')) ~ 'в сумму операции включен[а-я]* комиссия';

-- Подтверждённая владельцем пара 360 000 ₽: перевод между двумя его картами,
-- а не два платежа дивидендов. Связываем только при единственной паре.
do $$
declare
  v_outgoing uuid;
  v_incoming uuid;
  v_pair_id text;
  v_out_count integer;
  v_in_count integer;
begin
  select count(*) into v_out_count
  from public.bank_review_items
  where date = date '2026-09-23' and round(amount::numeric, 2) = -360000.00
    and status <> 'rejected'
    and lower(coalesce(counterparty, '') || ' ' || coalesce(purpose, '')) ~ 'п[.]? максим олегович';
  select id into v_outgoing from public.bank_review_items
  where date = date '2026-09-23' and round(amount::numeric, 2) = -360000.00
    and status <> 'rejected'
    and lower(coalesce(counterparty, '') || ' ' || coalesce(purpose, '')) ~ 'п[.]? максим олегович'
  order by id limit 1;

  select count(*) into v_in_count
  from public.bank_review_items
  where date = date '2026-09-23' and round(amount::numeric, 2) = 360000.00
    and status <> 'rejected'
    and lower(coalesce(counterparty, '') || ' ' || coalesce(purpose, '')) ~ 'п[.]? максим олегович';
  select id into v_incoming from public.bank_review_items
  where date = date '2026-09-23' and round(amount::numeric, 2) = 360000.00
    and status <> 'rejected'
    and lower(coalesce(counterparty, '') || ' ' || coalesce(purpose, '')) ~ 'п[.]? максим олегович'
  order by id limit 1;

  if v_out_count = 1 and v_in_count = 1 then
    v_pair_id := least(v_outgoing::text, v_incoming::text);
    update public.bank_review_items
    set matched_transfer_id = case when id = v_outgoing then v_incoming else v_outgoing end,
        category = case when id = v_outgoing then 'Выбытие — Перевод между счетами' else 'Поступление — Перевод между счетами' end,
        status = case when status = 'approved' then status when company_id is not null and account_id is not null then 'ready' else 'needs_info' end,
        updated_at = now()
    where id in (v_outgoing, v_incoming) and status <> 'rejected';

    update public.payments p
    set category = case when p.amount < 0 then 'Выбытие — Перевод между счетами' else 'Поступление — Перевод между счетами' end,
        comment = btrim(concat_ws(' ', nullif(p.comment, ''), '[dds-bank-transfer:' || v_pair_id || ']'))
    where p.import_source in ('bank-review:' || v_outgoing::text, 'bank-review:' || v_incoming::text)
      and p.status = 'done';
  end if;
end $$;

-- Ищем остальные однозначные пары по тем же строгим признакам, что сервер:
-- сумма, окно до трёх дней, разные счета и встречный счёт/ИНН владельца.
do $$
declare
  pair record;
  v_outgoing_company text;
  v_incoming_company text;
  v_is_loan boolean;
  v_ids_to_confirm uuid[];
begin
  for pair in
    with eligible as (
      select r.*,
        (select substring(value from length('__counterparty_account:') + 1)
         from jsonb_array_elements_text(coalesce(r.reasons, '[]'::jsonb)) value
         where value like '__counterparty_account:%' limit 1) counterparty_account
      from public.bank_review_items r
      where r.status in ('ready', 'needs_info', 'waiting_manager', 'approved')
        and r.matched_transfer_id is null
        and r.company_id is not null and r.account_id is not null
        and nullif(r.bank_account_number, '') is not null
    ), candidates as (
      select o.id outgoing_id, i.id incoming_id,
        count(*) over (partition by o.id) outgoing_candidates,
        count(*) over (partition by i.id) incoming_candidates
      from eligible o
      join eligible i on i.amount > 0 and o.amount < 0
        and round(i.amount::numeric, 2) = -round(o.amount::numeric, 2)
        and abs(i.date - o.date) <= 3
        and i.bank_account_number <> o.bank_account_number
        and (
          nullif(o.counterparty_account, '') = i.bank_account_number
          or nullif(i.counterparty_account, '') = o.bank_account_number
          or (nullif(o.owner_inn, '') is not null and o.owner_inn = i.owner_inn)
          or (nullif(o.counterparty_inn, '') is not null and o.counterparty_inn = i.owner_inn)
          or (nullif(i.counterparty_inn, '') is not null and i.counterparty_inn = o.owner_inn)
        )
    )
    select outgoing_id, incoming_id from candidates
    where outgoing_candidates = 1 and incoming_candidates = 1
  loop
    select lower(coalesce(c.group_name, '') || ' ' || coalesce(c.name, '')) into v_outgoing_company
    from public.bank_review_items r join public.companies c on c.id::text = r.company_id
    where r.id = pair.outgoing_id;
    select lower(coalesce(c.name, '')) into v_incoming_company
    from public.bank_review_items r join public.companies c on c.id::text = r.company_id
    where r.id = pair.incoming_id;
    v_is_loan := v_outgoing_company ~ '(основн|рио|митриченко|панкратов|кучеренко|глобалкос|иллюмей)'
      and v_incoming_company ~ '(филиппов|коровкин)';
    perform public.link_bank_review_transfer(
      pair.outgoing_id, pair.incoming_id,
      case when v_is_loan then 'Выдача кредитов и займов' else 'Выбытие — Перевод между счетами' end,
      case when v_is_loan then 'Получение кредитов и займов' else 'Поступление — Перевод между счетами' end
    );
    if not v_is_loan then
      select array_agg(r.id order by r.id) into v_ids_to_confirm
      from public.bank_review_items r
      where r.id in(pair.outgoing_id,pair.incoming_id)
        and r.status in('ready','needs_info')
        and r.company_id is not null and r.account_id is not null
        and nullif(r.category,'') is not null and r.manager_answer is null
        and exists(select 1 from public.accounts a where a.id::text=r.account_id)
        and exists(select 1 from public.companies c where c.id::text=r.company_id)
        and not exists(select 1 from public.payments p where p.import_source like 'bank-review:'||r.id::text||':%')
        and not exists(select 1 from public.finance_payment_chains ch where ch.id=r.id);
      if cardinality(v_ids_to_confirm)>0 then
        perform public.confirm_bank_review_items(v_ids_to_confirm);
      end if;
    end if;
  end loop;
end $$;

-- Ранее найденные точные пары (включая 503 000 ₽ от 18 сентября) могли иметь
-- только одну проведённую сторону. Обновляем статьи и подтверждаем недостающую.
do $$
declare
  pair record;
  ids_to_confirm uuid[];
  v_is_loan boolean;
begin
  for pair in
    select o.id outgoing_id, i.id incoming_id,
      lower(coalesce(oc.group_name, '') || ' ' || coalesce(oc.name, '')) outgoing_company,
      lower(coalesce(ic.name, '')) incoming_company
    from public.bank_review_items o
    join public.bank_review_items i on i.id = o.matched_transfer_id and i.matched_transfer_id = o.id
    join public.companies oc on oc.id::text = o.company_id
    join public.companies ic on ic.id::text = i.company_id
    where o.amount < 0 and i.amount > 0 and o.status <> 'rejected' and i.status <> 'rejected'
  loop
    v_is_loan := pair.outgoing_company ~ '(основн|рио|митриченко|панкратов|кучеренко|глобалкос|иллюмей)'
      and pair.incoming_company ~ '(филиппов|коровкин)';
    perform public.link_bank_review_transfer(
      pair.outgoing_id, pair.incoming_id,
      case when v_is_loan then 'Выдача кредитов и займов' else 'Выбытие — Перевод между счетами' end,
      case when v_is_loan then 'Получение кредитов и займов' else 'Поступление — Перевод между счетами' end
    );
    if not v_is_loan then
      select array_agg(r.id order by r.id) into ids_to_confirm
      from public.bank_review_items r
      where r.id in(pair.outgoing_id,pair.incoming_id)
        and r.status in('ready','needs_info')
        and r.company_id is not null and r.account_id is not null
        and nullif(r.category,'') is not null and r.manager_answer is null
        and exists(select 1 from public.accounts a where a.id::text=r.account_id)
        and exists(select 1 from public.companies c where c.id::text=r.company_id)
        and not exists(select 1 from public.payments p where p.import_source like 'bank-review:'||r.id::text||':%')
        and not exists(select 1 from public.finance_payment_chains ch where ch.id=r.id);
      if cardinality(ids_to_confirm)>0 then
        perform public.confirm_bank_review_items(ids_to_confirm);
      end if;
    end if;
  end loop;
end $$;

select public.link_unlinked_dds_transfers();
notify pgrst, 'reload schema';
