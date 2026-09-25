-- Исправляет очередь выписок после перехода на идентичность банковской
-- операции: старые строки без маркера больше не дублируют новые строки из
-- перекрывающихся периодов. Пользовательский комментарий из импорта также
-- переносится в фактический платёж при автоматическом подтверждении.

with canonical as (
  select b.id,b.bank_account_number,b.date,b.amount,b.counterparty_inn,b.purpose,b.reasons
  from public.bank_review_items b
  where exists (
    select 1 from jsonb_array_elements_text(coalesce(b.reasons,'[]'::jsonb)) reason
    where reason like '__operation_identity:%'
  )
), duplicate_pairs as (
  select legacy.id duplicate_id,canonical.id canonical_id
  from public.bank_review_items legacy
  join canonical on canonical.id<>legacy.id
   and canonical.bank_account_number=legacy.bank_account_number
   and canonical.date=legacy.date
   and canonical.amount=legacy.amount
   and coalesce(canonical.counterparty_inn,'')=coalesce(legacy.counterparty_inn,'')
   and regexp_replace(lower(coalesce(canonical.purpose,'')),'[^a-zа-я0-9]+','','g')
       =regexp_replace(lower(coalesce(legacy.purpose,'')),'[^a-zа-я0-9]+','','g')
  where not exists (
    select 1 from jsonb_array_elements_text(coalesce(legacy.reasons,'[]'::jsonb)) reason
    where reason like '__operation_identity:%'
  )
), unique_duplicates as (
  select duplicate_id,min(canonical_id::text)::uuid canonical_id
  from duplicate_pairs group by duplicate_id having count(*)=1
)
update public.payments p set status='cancelled',
 comment=trim(coalesce(p.comment,'')||' [duplicate-bank-review:'||u.canonical_id::text||']')
from unique_duplicates u
where p.import_source='bank-review:'||u.duplicate_id::text
  and p.status='done'
  and exists(select 1 from public.payments keeper where keeper.import_source='bank-review:'||u.canonical_id::text and keeper.status='done');

with canonical as (
  select b.id,b.bank_account_number,b.date,b.amount,b.counterparty_inn,b.purpose,b.reasons
  from public.bank_review_items b
  where exists (select 1 from jsonb_array_elements_text(coalesce(b.reasons,'[]'::jsonb)) reason where reason like '__operation_identity:%')
), duplicate_pairs as (
  select legacy.id duplicate_id,canonical.id canonical_id
  from public.bank_review_items legacy join canonical on canonical.id<>legacy.id
   and canonical.bank_account_number=legacy.bank_account_number and canonical.date=legacy.date and canonical.amount=legacy.amount
   and coalesce(canonical.counterparty_inn,'')=coalesce(legacy.counterparty_inn,'')
   and regexp_replace(lower(coalesce(canonical.purpose,'')),'[^a-zа-я0-9]+','','g')=regexp_replace(lower(coalesce(legacy.purpose,'')),'[^a-zа-я0-9]+','','g')
  where not exists (select 1 from jsonb_array_elements_text(coalesce(legacy.reasons,'[]'::jsonb)) reason where reason like '__operation_identity:%')
), unique_duplicates as (
  select duplicate_id,min(canonical_id::text)::uuid canonical_id from duplicate_pairs group by duplicate_id having count(*)=1
)
update public.bank_review_items b set status='rejected',updated_at=now(),
 reasons=coalesce(b.reasons,'[]'::jsonb)||jsonb_build_array('__duplicate_of:'||u.canonical_id::text)
from unique_duplicates u where b.id=u.duplicate_id and b.status in ('ready','needs_info','waiting_manager','approved');

create or replace function public.confirm_bank_review_items(p_ids uuid[]) returns integer
language plpgsql security definer set search_path=public as $$
declare r public.bank_review_items%rowtype; n integer:=0; pair_id text; user_comment text;
begin
 perform pg_advisory_xact_lock(hashtextextended('bank-review-confirm-link',0));
 if cardinality(p_ids)>10000 then raise exception 'Слишком много операций' using errcode='22023'; end if;
 for r in select * from public.bank_review_items where id=any(p_ids) order by id for update loop
  if r.status='approved' then continue; end if;
  if r.status not in ('ready','needs_info') or r.company_id is null or r.account_id is null or nullif(r.category,'') is null then
   raise exception 'Операция %: заполните компанию, кошелёк и статью',r.id using errcode='22023';
  end if;
  if not exists(select 1 from public.accounts a where a.id::text=r.account_id)
     or not exists(select 1 from public.companies c where c.id::text=r.company_id) then
   raise exception 'Операция %: компания или кошелёк не найдены в справочнике',r.id using errcode='22023';
  end if;
  if exists(select 1 from public.payments where import_source like 'bank-review:'||r.id::text||':%')
     or exists(select 1 from public.finance_payment_chains where id=r.id) then
   raise exception 'Операция % уже разбита: откройте всю цепочку',r.id using errcode='22023';
  end if;
  if exists(select 1 from public.payments where import_source='bank-review:'||r.id::text and
     row(amount,account_id::text,company_id::text,date,category,status)
       is distinct from row(r.amount,r.account_id,r.company_id,r.date,r.category,'done'::text)) then
   raise exception 'Операция % уже сохранена с другими данными. Откройте её для сверки.',r.id using errcode='40001';
  end if;
  pair_id:=case when r.matched_transfer_id is not null then least(r.id::text,r.matched_transfer_id::text) end;
  select nullif(trim(substr(reason,length('__payment_comment:')+1)),'') into user_comment
  from jsonb_array_elements_text(coalesce(r.reasons,'[]'::jsonb)) reason
  where reason like '__payment_comment:%' limit 1;
  if not exists(select 1 from public.payments where import_source='bank-review:'||r.id::text) then
   insert into public.payments(id,name,amount,type,category,account_id,company_id,date,status,counterparty,comment,import_source)
   values(gen_random_uuid(),r.purpose,r.amount,case when r.amount<0 then 'expense' else 'income' end,
     r.category,r.account_id::uuid,r.company_id::uuid,r.date,'done',coalesce(r.counterparty,''),
     coalesce(user_comment||' · ','')||'Банковская выписка · '||r.source_file_name||coalesce(' [dds-bank-transfer:'||pair_id||']',''),'bank-review:'||r.id::text);
   n:=n+1;
  end if;
  update public.bank_review_items set status='approved' where id=r.id;
 end loop;
 return n;
end; $$;

revoke all on function public.confirm_bank_review_items(uuid[]) from public;
grant execute on function public.confirm_bank_review_items(uuid[]) to service_role;
notify pgrst,'reload schema';
