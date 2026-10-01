-- Owner applies after 202609290001. Allows one incoming statement row to be
-- funded by several partial transfers and projects every part onto that row.
create or replace function public.save_dds_payment_chain(
 p_chain_id uuid, p_expected_revision integer, p_draft jsonb,
 p_entries jsonb, p_origin_ids uuid[] default '{}', p_cancel boolean default false
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_revision integer; v_new_revision integer; v_item jsonb; v_origin uuid;
 v_previous_setting text; v_balance_issue record; v_target_issue record; v_import_source text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_chain_id::text,0));
 -- The same incoming row may be completed by several chains. Row locks make
 -- the remaining amount check atomic even when two users save at once.
 perform 1 from public.bank_review_items review
 where review.id in (
   select nullif(allocation->>'targetReviewId','')::uuid
   from jsonb_array_elements(coalesce(p_draft->'allocations','[]'::jsonb)) allocation
   where nullif(allocation->>'targetReviewId','') is not null
   union
   select nullif(allocation->>'targetReviewId','')::uuid
   from public.finance_payment_chains chain,
     jsonb_array_elements(coalesce(chain.draft->'allocations','[]'::jsonb)) allocation
   where chain.id=p_chain_id and nullif(allocation->>'targetReviewId','') is not null
 ) order by review.id for update;
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
 if not p_cancel then
   select review.id, review.amount, coalesce(sum(parts.amount),0) allocated
   into v_target_issue
   from public.bank_review_items review
   left join lateral (
     select (allocation->>'amount')::numeric amount
     from public.finance_payment_chains chain,
       jsonb_array_elements(coalesce(chain.draft->'allocations','[]'::jsonb)) allocation
     where chain.status='active' and chain.id<>p_chain_id
       and nullif(allocation->>'targetReviewId','')::uuid=review.id
       and coalesce((allocation->>'excluded')::boolean,false)=false
     union all
     select (allocation->>'amount')::numeric
     from jsonb_array_elements(coalesce(p_draft->'allocations','[]'::jsonb)) allocation
     where nullif(allocation->>'targetReviewId','')::uuid=review.id
       and coalesce((allocation->>'excluded')::boolean,false)=false
   ) parts on true
   where review.id in (
     select nullif(allocation->>'targetReviewId','')::uuid
     from jsonb_array_elements(coalesce(p_draft->'allocations','[]'::jsonb)) allocation
     where nullif(allocation->>'targetReviewId','') is not null
   )
   group by review.id,review.amount
   having coalesce(sum(parts.amount),0)>review.amount
   limit 1;
   if found then
     raise exception 'Связанные части превышают поступление %: % ₽ из % ₽', v_target_issue.id,v_target_issue.allocated,v_target_issue.amount using errcode='22023';
   end if;
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
 update public.payments payment set status='cancelled'
 where payment.status='done'
   and payment.import_source ~ '^bank-review:[0-9a-f-]{36}(:|$)'
   and substring(payment.import_source from '^bank-review:([0-9a-f-]{36})')::uuid in (
     select nullif(allocation->>'targetReviewId','')::uuid
     from jsonb_array_elements(coalesce(p_draft->'allocations','[]'::jsonb)) allocation
     where nullif(allocation->>'targetReviewId','') is not null
   )
   and not exists(select 1 from public.finance_payment_chain_entries entry where entry.payment_id=payment.id);
 update public.payments p set status='cancelled'
 where p.id in (select payment_id from public.finance_payment_chain_entries where chain_id=p_chain_id)
   and p.status <> 'cancelled';
 v_new_revision := v_revision+1;
 if not p_cancel then
   for v_item in select value from jsonb_array_elements(p_entries) loop
     v_import_source := 'dds-chain:'||p_chain_id::text||':'||v_new_revision::text||':'||(v_item->'payment'->>'id');
     if v_item->>'role'='transfer-in' then
       select 'bank-review:'||(allocation->>'targetReviewId')||':chain:'||p_chain_id::text
       into v_import_source
       from jsonb_array_elements(coalesce(p_draft->'allocations','[]'::jsonb)) allocation
       where allocation->>'id'=v_item->>'allocationId'
         and nullif(allocation->>'targetReviewId','') is not null;
       v_import_source:=coalesce(v_import_source,'dds-chain:'||p_chain_id::text||':'||v_new_revision::text||':'||(v_item->'payment'->>'id'));
     end if;
     insert into public.payments(id,name,amount,type,category,account_id,company_id,date,status,counterparty,comment,import_source)
     values((v_item->'payment'->>'id')::uuid,v_item->'payment'->>'name',(v_item->'payment'->>'amount')::numeric,
       case when (v_item->'payment'->>'amount')::numeric<0 then 'expense' else 'income' end,
       v_item->'payment'->>'category',(v_item->'payment'->>'accountId')::uuid,(v_item->'payment'->>'companyId')::uuid,
       (v_item->'payment'->>'date')::date,'done',coalesce(v_item->'payment'->>'counterparty',''),v_item->'payment'->>'comment',
       v_import_source);
     insert into public.finance_payment_chain_entries(payment_id,chain_id,revision,role,allocation_id)
       values((v_item->'payment'->>'id')::uuid,p_chain_id,v_new_revision,v_item->>'role',nullif(v_item->>'allocationId','')::uuid);
   end loop;
 end if;
 -- A revised/cancelled chain releases incoming statement rows that it no longer uses.
 update public.bank_review_items review set status='needs_info',updated_at=now()
 where review.id in (
   select nullif(allocation->>'targetReviewId','')::uuid
   from public.finance_payment_chains chain,
     jsonb_array_elements(coalesce(chain.draft->'allocations','[]'::jsonb)) allocation
   where chain.id=p_chain_id and nullif(allocation->>'targetReviewId','') is not null
 ) and (p_cancel or review.id not in (
   select nullif(allocation->>'targetReviewId','')::uuid
   from jsonb_array_elements(coalesce(p_draft->'allocations','[]'::jsonb)) allocation
   where nullif(allocation->>'targetReviewId','') is not null
 ));
 update public.finance_payment_chains set revision=v_new_revision,status=case when p_cancel then 'cancelled' else 'active' end,
   draft=jsonb_set(p_draft,'{revision}',to_jsonb(v_new_revision)),updated_at=now() where id=p_chain_id;
 insert into public.finance_payment_chain_revisions(chain_id,revision,draft,reason)
 values(p_chain_id,v_new_revision,jsonb_set(p_draft,'{revision}',to_jsonb(v_new_revision)),
   case when p_cancel then 'Цепочка отменена' when v_revision=0 then 'Цепочка создана' else 'Прежние записи отменены, сохранена новая версия' end);
 update public.bank_review_items set status=case when p_cancel then 'needs_info' else 'approved' end,updated_at=now()
 where id=(p_draft->>'bankReviewId')::uuid;
 -- A target row can be partially covered. It is approved only after all active
 -- transfer parts add up to the statement amount.
 update public.bank_review_items review set status=case when totals.allocated=review.amount then 'approved' else 'needs_info' end,updated_at=now()
 from (
   select target_id,sum(amount) allocated from (
     select nullif(allocation->>'targetReviewId','')::uuid target_id,(allocation->>'amount')::numeric amount
     from public.finance_payment_chains chain,
       jsonb_array_elements(coalesce(chain.draft->'allocations','[]'::jsonb)) allocation
     where chain.status='active' and nullif(allocation->>'targetReviewId','') is not null
       and coalesce((allocation->>'excluded')::boolean,false)=false
   ) active_parts group by target_id
 ) totals where review.id=totals.target_id;
 update public.bank_review_items review set status='needs_info',updated_at=now()
 where review.id in (
   select nullif(allocation->>'targetReviewId','')::uuid
   from public.finance_payment_chain_revisions revision,
     jsonb_array_elements(coalesce(revision.draft->'allocations','[]'::jsonb)) allocation
   where revision.chain_id=p_chain_id and nullif(allocation->>'targetReviewId','') is not null
 ) and not exists (
   select 1 from public.finance_payment_chains chain,
     jsonb_array_elements(coalesce(chain.draft->'allocations','[]'::jsonb)) allocation
   where chain.status='active' and nullif(allocation->>'targetReviewId','')::uuid=review.id
 );
 perform set_config('finance.chain_edit',v_previous_setting,true);
 return jsonb_build_object('revision',v_new_revision);
end; $$;

-- Keep execution restricted to the server role.
revoke all on function public.save_dds_payment_chain(uuid,integer,jsonb,jsonb,uuid[],boolean) from public;
grant execute on function public.save_dds_payment_chain(uuid,integer,jsonb,jsonb,uuid[],boolean) to service_role;
create or replace function public.dds_partial_wallet_provenance_version() returns integer
language sql stable security definer set search_path=public as $$ select 1 $$;
revoke all on function public.dds_partial_wallet_provenance_version() from public;
grant execute on function public.dds_partial_wallet_provenance_version() to service_role;
notify pgrst,'reload schema';
