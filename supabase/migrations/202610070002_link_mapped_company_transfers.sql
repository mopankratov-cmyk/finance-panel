-- Карточные выписки часто не содержат ИНН и полного номера встречного счёта.
-- Если обе строки уже сопоставлены с разными кошельками одной компании,
-- одинаковая встречная сумма в один день и текст перевода подтверждают пару.
-- Явно переданный банком встречный счёт по-прежнему обязан совпасть.

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
  mapped_company_accounts boolean;
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

    mapped_company_accounts := nullif(o.company_id,'') is not null
      and o.company_id=i.company_id
      and nullif(o.account_id,'') is not null
      and nullif(i.account_id,'') is not null
      and o.account_id<>i.account_id
      and o.date=i.date
      and lower(coalesce(o.category,'')||' '||coalesce(o.purpose,''))
        ~ '(перевод|собственн(ых|ые) средств|между своими сч(е|ё)тами)'
      and lower(coalesce(i.category,'')||' '||coalesce(i.purpose,''))
        ~ '(перевод|собственн(ых|ые) средств|между своими сч(е|ё)тами)';

    if (nullif(oa,'') is not null and oa<>i.bank_account_number)
       or (nullif(ia,'') is not null and ia<>o.bank_account_number)
       or not (
         coalesce(oa=i.bank_account_number,false)
         or coalesce(ia=o.bank_account_number,false)
         or (nullif(o.owner_inn,'') is not null and o.owner_inn=i.owner_inn)
         or (nullif(o.counterparty_inn,'') is not null and o.counterparty_inn=i.owner_inn)
         or (nullif(i.counterparty_inn,'') is not null and i.counterparty_inn=o.owner_inn)
         or mapped_company_accounts
       ) then
      raise exception 'Реквизиты и известные кошельки не подтверждают перевод между этими счетами' using errcode='22023';
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

-- Связываем все накопившиеся однозначные пары. Суммы здесь не зашиты:
-- миграция проходит по всей активной банковской очереди. Несколько одинаковых
-- переводов связываются только в закрытой группе между теми же двумя счетами.
create or replace function public.link_mapped_company_transfers()
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  pair record;
  outgoing_company text;
  incoming_company text;
  is_filippov_loan boolean;
  ids_to_confirm uuid[];
  linked_pairs integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('link-mapped-company-transfers',0));
  for pair in
    with eligible as (
      select r.*,
        (select substring(reason from length('__counterparty_account:')+1)
         from jsonb_array_elements_text(coalesce(r.reasons,'[]'::jsonb)) reason
         where reason like '__counterparty_account:%' limit 1) counterparty_account
      from public.bank_review_items r
      where r.status in ('ready','needs_info','waiting_manager','approved')
        and r.matched_transfer_id is null
        and r.company_id is not null and r.account_id is not null
        and nullif(r.bank_account_number,'') is not null
    ), all_edges as (
      select o.id outgoing_id, i.id incoming_id,
        o.date outgoing_date, i.date incoming_date,
        round(abs(o.amount)::numeric,2) payment_amount,
        o.bank_account_number outgoing_account,
        i.bank_account_number incoming_account
      from eligible o
      join eligible i on o.amount<0 and i.amount>0
        and round(i.amount::numeric,2)=-round(o.amount::numeric,2)
        and abs(i.date-o.date)<=3
        and i.bank_account_number<>o.bank_account_number
        and (nullif(o.counterparty_account,'') is null or o.counterparty_account=i.bank_account_number)
        and (nullif(i.counterparty_account,'') is null or i.counterparty_account=o.bank_account_number)
        and (
          o.counterparty_account=i.bank_account_number
          or i.counterparty_account=o.bank_account_number
          or (nullif(o.owner_inn,'') is not null and o.owner_inn=i.owner_inn)
          or (nullif(o.counterparty_inn,'') is not null and o.counterparty_inn=i.owner_inn)
          or (nullif(i.counterparty_inn,'') is not null and i.counterparty_inn=o.owner_inn)
          or (
            o.company_id=i.company_id and o.account_id<>i.account_id and o.date=i.date
            and lower(coalesce(o.category,'')||' '||coalesce(o.purpose,''))
              ~ '(перевод|собственн(ых|ые) средств|между своими сч(е|ё)тами)'
            and lower(coalesce(i.category,'')||' '||coalesce(i.purpose,''))
              ~ '(перевод|собственн(ых|ые) средств|между своими сч(е|ё)тами)'
          )
        )
    ), counted_edges as (
      select e.*,
        count(*) over(partition by outgoing_id) outgoing_candidates,
        count(*) over(partition by incoming_id) incoming_candidates
      from all_edges e
    ), single_pairs as (
      select outgoing_id,incoming_id from counted_edges
      where outgoing_candidates=1 and incoming_candidates=1
    ), batch_edges as (
      select * from all_edges where outgoing_date=incoming_date
    ), group_counts as (
      select outgoing_date payment_date,payment_amount,outgoing_account,incoming_account,
        count(distinct outgoing_id) outgoing_count,
        count(distinct incoming_id) incoming_count
      from batch_edges
      group by outgoing_date,payment_amount,outgoing_account,incoming_account
    ), outgoing_totals as (
      select outgoing_id,count(distinct incoming_id) candidate_count
      from all_edges group by outgoing_id
    ), incoming_totals as (
      select incoming_id,count(distinct outgoing_id) candidate_count
      from all_edges group by incoming_id
    ), safe_groups as (
      select g.* from group_counts g
      where g.outgoing_count=g.incoming_count and g.outgoing_count>1
        and not exists (
          select 1 from batch_edges e join outgoing_totals t using(outgoing_id)
          where e.outgoing_date=g.payment_date and e.payment_amount=g.payment_amount
            and e.outgoing_account=g.outgoing_account and e.incoming_account=g.incoming_account
            and t.candidate_count<>g.incoming_count
        )
        and not exists (
          select 1 from batch_edges e join incoming_totals t using(incoming_id)
          where e.outgoing_date=g.payment_date and e.payment_amount=g.payment_amount
            and e.outgoing_account=g.outgoing_account and e.incoming_account=g.incoming_account
            and t.candidate_count<>g.outgoing_count
        )
    ), batch_outgoing as (
      select distinct e.outgoing_date payment_date,e.payment_amount,e.outgoing_account,e.incoming_account,e.outgoing_id
      from batch_edges e join safe_groups g
        on g.payment_date=e.outgoing_date and g.payment_amount=e.payment_amount
       and g.outgoing_account=e.outgoing_account and g.incoming_account=e.incoming_account
    ), batch_incoming as (
      select distinct e.outgoing_date payment_date,e.payment_amount,e.outgoing_account,e.incoming_account,e.incoming_id
      from batch_edges e join safe_groups g
        on g.payment_date=e.outgoing_date and g.payment_amount=e.payment_amount
       and g.outgoing_account=e.outgoing_account and g.incoming_account=e.incoming_account
    ), outgoing_ranked as (
      select e.*,row_number() over(
        partition by payment_date,payment_amount,outgoing_account,incoming_account order by outgoing_id
      ) ordinal from batch_outgoing e
    ), incoming_ranked as (
      select e.*,row_number() over(
        partition by payment_date,payment_amount,outgoing_account,incoming_account order by incoming_id
      ) ordinal from batch_incoming e
    ), batch_pairs as (
      select o.outgoing_id,i.incoming_id
      from outgoing_ranked o join incoming_ranked i
        using(payment_date,payment_amount,outgoing_account,incoming_account,ordinal)
    )
    select outgoing_id,incoming_id from single_pairs
    union all
    select outgoing_id,incoming_id from batch_pairs
  loop
    select lower(coalesce(c.group_name,'')||' '||coalesce(c.name,'')) into outgoing_company
    from public.bank_review_items r join public.companies c on c.id::text=r.company_id
    where r.id=pair.outgoing_id;
    select lower(coalesce(c.name,'')) into incoming_company
    from public.bank_review_items r join public.companies c on c.id::text=r.company_id
    where r.id=pair.incoming_id;

    is_filippov_loan := outgoing_company ~ '(основн|рио|митриченко|панкратов|кучеренко|глобалкос|иллюмей)'
      and incoming_company ~ '(филиппов|коровкин)';
    perform public.link_bank_review_transfer(
      pair.outgoing_id,
      pair.incoming_id,
      case when is_filippov_loan then 'Выдача кредитов и займов' else 'Выбытие — Перевод между счетами' end,
      case when is_filippov_loan then 'Получение кредитов и займов' else 'Поступление — Перевод между счетами' end
    );

    if not is_filippov_loan then
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
    linked_pairs := linked_pairs+1;
  end loop;
  perform public.link_unlinked_dds_transfers();
  return jsonb_build_object('linkedPairs',linked_pairs);
end; $$;

revoke all on function public.link_mapped_company_transfers() from public;
grant execute on function public.link_mapped_company_transfers() to service_role;

select public.link_mapped_company_transfers();
notify pgrst,'reload schema';
