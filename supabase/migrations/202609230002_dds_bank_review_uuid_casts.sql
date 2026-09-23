-- bank_review_items predates UUID foreign keys and keeps company_id/account_id
-- as text. payments uses UUID for both columns. PostgreSQL cannot compare the
-- two row values without an explicit cast (uuid = text), so confirmation of a
-- newly imported statement failed before any payment was inserted.

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
  -- Compare through text before casting so a stale/deleted reference produces
  -- a useful validation error instead of PostgreSQL's uuid input/operator error.
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
  if not exists(select 1 from public.payments where import_source='bank-review:'||r.id::text) then
   insert into public.payments(id,name,amount,type,category,account_id,company_id,date,status,counterparty,comment,import_source)
   values(gen_random_uuid(),r.purpose,r.amount,case when r.amount<0 then 'expense' else 'income' end,
     r.category,r.account_id::uuid,r.company_id::uuid,r.date,'done',coalesce(r.counterparty,''),
     'Банковская выписка · '||r.source_file_name||coalesce(' [dds-bank-transfer:'||pair_id||']',''),'bank-review:'||r.id::text);
   n:=n+1;
  end if;
  update public.bank_review_items set status='approved' where id=r.id;
 end loop;
 return n;
end; $$;

revoke all on function public.confirm_bank_review_items(uuid[]) from public;
grant execute on function public.confirm_bank_review_items(uuid[]) to service_role;
notify pgrst,'reload schema';
