-- Owner applies after 202609140002. Also updates the RPC in already migrated environments.
create or replace function public.save_dds_payment_chain(
 p_chain_id uuid, p_expected_revision integer, p_draft jsonb,
 p_entries jsonb, p_origin_ids uuid[] default '{}', p_cancel boolean default false
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_revision integer; v_new_revision integer; v_item jsonb; v_origin uuid;
 v_previous_setting text; v_balance_issue record;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_chain_id::text,0));
 select revision into v_revision from public.finance_payment_chains where id=p_chain_id for update;
 if v_revision is null then
   if p_expected_revision <> 0 or p_cancel then raise exception 'Цепочка не найдена' using errcode='P0001'; end if;
   insert into public.finance_payment_chains(id,draft) values(p_chain_id,p_draft);
   v_revision := 0;
 elsif v_revision <> p_expected_revision then
   raise exception 'Цепочка уже изменена другим пользователем. Откройте её заново.' using errcode='40001';
 end if;
 if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries)>402 then
   raise exception 'Некорректные части цепочки' using errcode='22023';
 end if;
 -- Internal transfers and both loan sides must balance per allocation, not only overall.
 select kind, allocation_id, sum(amount) as net into v_balance_issue from (
   select case
     when item->>'role' in ('loan-out','loan-in') then 'Займ между компаниями'
     when item->>'role'='cash-in' or (item->>'role'='source' and nullif(item->>'allocationId','') is null and item->'payment'->>'category'='Выбытие — Перевод между счетами') then 'Перевод в наличные'
     when item->>'role'='transfer-in' or (item->>'role' in ('source','spending') and item->'payment'->>'category'='Выбытие — Перевод между счетами') then 'Перевод между кошельками'
   end as kind, item->>'allocationId' as allocation_id, (item->'payment'->>'amount')::numeric as amount
   from jsonb_array_elements(p_entries) item
 ) checked where kind is not null group by kind,allocation_id
 having sum(amount)<>0 or count(*)<>2 or count(*) filter(where amount<0)<>1 or count(*) filter(where amount>0)<>1
 limit 1;
 if found then
   raise exception '%: выбытие и поступление не сходятся. Разница % ₽, часть %', v_balance_issue.kind, v_balance_issue.net, coalesce(v_balance_issue.allocation_id,'исходная сумма') using errcode='22023';
 end if;
 -- Origin rows are read and locked here, not taken from client snapshots.
 if v_revision=0 then
   foreach v_origin in array p_origin_ids loop
     perform 1 from public.payments where id=v_origin and status='done' for update;
     if not found or exists(select 1 from public.finance_payment_chain_entries where payment_id=v_origin) then
       raise exception 'Исходная операция уже изменена или входит в другую цепочку' using errcode='40001';
     end if;
     insert into public.finance_payment_chain_entries(payment_id,chain_id,revision,role) values(v_origin,p_chain_id,0,'legacy');
   end loop;
   if cardinality(p_origin_ids)>0 then
     insert into public.finance_payment_chain_revisions(chain_id,revision,draft,reason)
       values(p_chain_id,0,p_draft,'Исходные записи до создания цепочки');
   end if;
 elsif cardinality(p_origin_ids)>0 then
   raise exception 'Повторная цепочка не принимает новые исходные записи' using errcode='22023';
 end if;
 if exists (
  select 1 from public.payments related
  join public.finance_payment_chain_entries e on e.chain_id=p_chain_id
  where position('[calendar-fact:'||e.payment_id::text||']' in coalesce(related.comment,''))>0
     or position('[paid-by:'||e.payment_id::text||']' in coalesce(related.comment,''))>0
 ) then raise exception 'Одна из операций уже закрывает план или обязательство. Сначала отмените её сверку, затем измените цепочку.' using errcode='P0001'; end if;
 v_previous_setting := coalesce(current_setting('finance.chain_edit',true),'');
 perform set_config('finance.chain_edit','on',true);
 update public.payments p set status='cancelled'
 where p.id in (select payment_id from public.finance_payment_chain_entries where chain_id=p_chain_id)
   and p.status <> 'cancelled';
 v_new_revision := v_revision+1;
 if not p_cancel then
   for v_item in select value from jsonb_array_elements(p_entries) loop
     insert into public.payments(id,name,amount,type,category,account_id,company_id,date,status,counterparty,comment,import_source)
     values((v_item->'payment'->>'id')::uuid,v_item->'payment'->>'name',(v_item->'payment'->>'amount')::numeric,
       case when (v_item->'payment'->>'amount')::numeric<0 then 'expense' else 'income' end,
       v_item->'payment'->>'category',(v_item->'payment'->>'accountId')::uuid,(v_item->'payment'->>'companyId')::uuid,
       (v_item->'payment'->>'date')::date,'done',coalesce(v_item->'payment'->>'counterparty',''),v_item->'payment'->>'comment',
       'dds-chain:'||p_chain_id::text||':'||v_new_revision::text||':'||(v_item->'payment'->>'id'));
     insert into public.finance_payment_chain_entries(payment_id,chain_id,revision,role,allocation_id)
       values((v_item->'payment'->>'id')::uuid,p_chain_id,v_new_revision,v_item->>'role',nullif(v_item->>'allocationId','')::uuid);
   end loop;
 end if;
 update public.finance_payment_chains set revision=v_new_revision,status=case when p_cancel then 'cancelled' else 'active' end,
   draft=jsonb_set(p_draft,'{revision}',to_jsonb(v_new_revision)),updated_at=now() where id=p_chain_id;
 insert into public.finance_payment_chain_revisions(chain_id,revision,draft,reason)
 values(p_chain_id,v_new_revision,jsonb_set(p_draft,'{revision}',to_jsonb(v_new_revision)),
   case when p_cancel then 'Цепочка отменена' when v_revision=0 then 'Цепочка создана' else 'Прежние записи отменены, сохранена новая версия' end);
 if p_draft->>'bankReviewId' is not null then
   update public.bank_review_items set status=case when p_cancel then 'needs_info' else 'approved' end
     where id=(p_draft->>'bankReviewId')::uuid;
 end if;
 perform set_config('finance.chain_edit',v_previous_setting,true);
 return jsonb_build_object('revision',v_new_revision);
end; $$;

-- Owner applies. Confirmation and reciprocal linking each run in one transaction.
create or replace function public.confirm_bank_review_items(p_ids uuid[]) returns integer
language plpgsql security definer set search_path=public as $$
declare r public.bank_review_items%rowtype; n integer:=0; pair_id text;
begin
 perform pg_advisory_xact_lock(hashtextextended('bank-review-confirm-link',0));
 if cardinality(p_ids)>10000 then raise exception 'Слишком много операций' using errcode='22023'; end if;
 for r in select * from public.bank_review_items where id=any(p_ids) order by id for update loop
  if r.status='approved' then continue; end if;
  if r.status not in ('ready','needs_info') or r.company_id is null or r.account_id is null or nullif(r.category,'') is null then
   raise exception 'Операция %: заполните компанию, кошелёк и статью',r.id using errcode='22023';
  end if;
  if exists(select 1 from public.payments where import_source like 'bank-review:'||r.id::text||':%')
     or exists(select 1 from public.finance_payment_chains where id=r.id) then
   raise exception 'Операция % уже разбита: откройте всю цепочку',r.id using errcode='22023';
  end if;
  if exists(select 1 from public.payments where import_source='bank-review:'||r.id::text and
     row(amount,account_id,company_id,date,category,status) is distinct from row(r.amount,r.account_id,r.company_id,r.date,r.category,'done'::text)) then
   raise exception 'Операция % уже сохранена с другими данными. Откройте её для сверки.',r.id using errcode='40001';
  end if;
  pair_id:=case when r.matched_transfer_id is not null then least(r.id::text,r.matched_transfer_id::text) end;
  if not exists(select 1 from public.payments where import_source='bank-review:'||r.id::text) then
   insert into public.payments(id,name,amount,type,category,account_id,company_id,date,status,counterparty,comment,import_source)
   values(gen_random_uuid(),r.purpose,r.amount,case when r.amount<0 then 'expense' else 'income' end,r.category,r.account_id,r.company_id,r.date,'done',coalesce(r.counterparty,''),
     'Банковская выписка · '||r.source_file_name||coalesce(' [dds-bank-transfer:'||pair_id||']',''),'bank-review:'||r.id::text);
   n:=n+1;
  end if;
  update public.bank_review_items set status='approved' where id=r.id;
 end loop;
 return n;
end; $$;

create or replace function public.link_bank_review_transfer(p_outgoing uuid,p_incoming uuid,p_outgoing_category text,p_incoming_category text) returns boolean
language plpgsql security definer set search_path=public as $$
declare o public.bank_review_items%rowtype; i public.bank_review_items%rowtype; oa text; ia text; pair_id text;
begin
 perform pg_advisory_xact_lock(hashtextextended('bank-review-confirm-link',0));
 perform 1 from public.bank_review_items where id in (p_outgoing,p_incoming) order by id for update;
 select * into o from public.bank_review_items where id=p_outgoing;
 select * into i from public.bank_review_items where id=p_incoming;
 if o.id is null or i.id is null or o.status='rejected' or i.status='rejected' then raise exception 'Операции не найдены' using errcode='22023'; end if;
 if o.matched_transfer_id=i.id and i.matched_transfer_id=o.id then return true; end if;
 if o.matched_transfer_id is not null or i.matched_transfer_id is not null then raise exception 'Операция уже связана с другим переводом' using errcode='40001'; end if;
 if o.amount>=0 or i.amount<=0 or round(o.amount,2)+round(i.amount,2)<>0 or abs(o.date-i.date)>3
    or nullif(o.bank_account_number,'') is null or nullif(i.bank_account_number,'') is null or o.bank_account_number=i.bank_account_number then
   raise exception 'Не сходятся сумма, даты или счета перевода' using errcode='22023';
 end if;
 select substring(value from length('__counterparty_account:')+1) into oa from jsonb_array_elements_text(to_jsonb(o.reasons)) value where value like '__counterparty_account:%' limit 1;
 select substring(value from length('__counterparty_account:')+1) into ia from jsonb_array_elements_text(to_jsonb(i.reasons)) value where value like '__counterparty_account:%' limit 1;
 if (nullif(oa,'') is not null and oa<>i.bank_account_number) or (nullif(ia,'') is not null and ia<>o.bank_account_number)
   or not (coalesce(oa=i.bank_account_number,false) or coalesce(ia=o.bank_account_number,false)
     or (nullif(o.counterparty_inn,'') is not null and o.counterparty_inn=i.owner_inn)
     or (nullif(i.counterparty_inn,'') is not null and i.counterparty_inn=o.owner_inn)) then
   raise exception 'Реквизиты не подтверждают перевод между этими счетами' using errcode='22023';
 end if;
 update public.bank_review_items set matched_transfer_id=case when id=o.id then i.id else o.id end,
  category=case when status='approved' then category when id=o.id then p_outgoing_category else p_incoming_category end,
  status=case when status='approved' then status when company_id is not null and account_id is not null then 'ready' else 'needs_info' end where id in(o.id,i.id);
 pair_id:=least(o.id::text,i.id::text);
 -- Existing facts keep their amounts/categories; add the relationship to both bank facts.
 update public.payments set comment=coalesce(comment,'')||' [dds-bank-transfer:'||pair_id||']'
 where import_source in ('bank-review:'||o.id::text,'bank-review:'||i.id::text) and status='done'
   and position('[dds-bank-transfer:'||pair_id||']' in coalesce(comment,''))=0;
 return true;
end; $$;
revoke all on function public.confirm_bank_review_items(uuid[]) from public;
revoke all on function public.link_bank_review_transfer(uuid,uuid,text,text) from public;
grant execute on function public.confirm_bank_review_items(uuid[]) to service_role;
grant execute on function public.link_bank_review_transfer(uuid,uuid,text,text) to service_role;
notify pgrst,'reload schema';
