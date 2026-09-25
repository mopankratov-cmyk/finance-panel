-- Связанные выписки разных юрлиц основной группы являются обычным переводом.
-- Займ создаётся только при переводе из основной группы Филиппову/Коровкину.
-- Одновременно функция приводит к правильной статье уже проведённую сторону,
-- а существующие точные внутренние пары доводит до двух фактов ДДС.

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

do $$
declare
  pair record;
  ids_to_confirm uuid[];
  is_filippov_loan boolean;
begin
  for pair in
    select
      o.id outgoing_id,
      i.id incoming_id,
      lower(coalesce(oc.group_name,'')||' '||coalesce(oc.name,'')) outgoing_company,
      lower(coalesce(ic.name,'')) incoming_company
    from public.bank_review_items o
    join public.bank_review_items i on i.id=o.matched_transfer_id
    join public.companies oc on oc.id::text=o.company_id
    join public.companies ic on ic.id::text=i.company_id
    where o.amount<0 and i.amount>0 and i.matched_transfer_id=o.id
  loop
    is_filippov_loan :=
      pair.outgoing_company ~ '(основн|рио|митриченко|панкратов|кучеренко)'
      and pair.incoming_company ~ '(филиппов|коровкин)';

    perform public.link_bank_review_transfer(
      pair.outgoing_id,
      pair.incoming_id,
      case when is_filippov_loan then 'Выдача кредитов и займов' else 'Выбытие — Перевод между счетами' end,
      case when is_filippov_loan then 'Получение кредитов и займов' else 'Поступление — Перевод между счетами' end
    );

    -- Точную пару обычного внутреннего перевода не заставляем повторно
    -- подтверждать: обе стороны, кошельки, сумма и реквизиты уже совпали.
    if not is_filippov_loan then
      select array_agg(r.id order by r.id) into ids_to_confirm
      from public.bank_review_items r
      where r.id in(pair.outgoing_id,pair.incoming_id)
        and r.status in('ready','needs_info')
        and r.company_id is not null
        and r.account_id is not null
        and nullif(r.category,'') is not null
        and r.manager_answer is null
        and exists(select 1 from public.accounts a where a.id::text=r.account_id)
        and exists(select 1 from public.companies c where c.id::text=r.company_id)
        and not exists(
          select 1 from public.payments p
          where p.import_source like 'bank-review:'||r.id::text||':%'
        )
        and not exists(select 1 from public.finance_payment_chains ch where ch.id=r.id);
      if cardinality(ids_to_confirm)>0 then
        perform public.confirm_bank_review_items(ids_to_confirm);
      end if;
    end if;
  end loop;
end $$;

notify pgrst,'reload schema';
