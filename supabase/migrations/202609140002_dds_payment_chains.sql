-- Apply by the repository owner. One transaction for replacing a funding chain.
create table if not exists public.finance_payment_chains (
  id uuid primary key,
  revision integer not null default 0,
  status text not null default 'active' check (status in ('active','cancelled')),
  draft jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.finance_payment_chain_revisions (
  chain_id uuid not null references public.finance_payment_chains(id),
  revision integer not null,
  draft jsonb not null,
  reason text not null,
  created_at timestamptz not null default now(),
  primary key (chain_id, revision)
);
create table if not exists public.finance_payment_chain_entries (
  payment_id uuid primary key references public.payments(id) on delete restrict,
  chain_id uuid not null references public.finance_payment_chains(id),
  revision integer not null,
  role text not null check (role in ('source','cash-in','loan-out','loan-in','transfer-in','spending','legacy')),
  allocation_id uuid
);
create index if not exists finance_chain_entries_chain_revision_idx on public.finance_payment_chain_entries(chain_id,revision);
alter table public.finance_payment_chains enable row level security;
alter table public.finance_payment_chain_revisions enable row level security;
alter table public.finance_payment_chain_entries enable row level security;
revoke all on public.finance_payment_chains, public.finance_payment_chain_revisions, public.finance_payment_chain_entries from anon, authenticated;
grant all on public.finance_payment_chains, public.finance_payment_chain_revisions, public.finance_payment_chain_entries to service_role;

create or replace function public.protect_dds_chain_payment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('finance.chain_edit',true),'') = 'on' then return new; end if;
  if row(old.amount,old.account_id,old.company_id,old.date,old.category,old.status,old.name,old.counterparty)
      is distinct from row(new.amount,new.account_id,new.company_id,new.date,new.category,new.status,new.name,new.counterparty)
     and exists(select 1 from public.finance_payment_chain_entries where payment_id=old.id) then
    raise exception 'Операция входит в цепочку. Откройте всю исходную сумму и сохраните изменение цепочки: связанные записи будут отменены атомарно.' using errcode='P0001';
  end if;
  return new;
end; $$;
drop trigger if exists protect_dds_chain_payment on public.payments;
create trigger protect_dds_chain_payment before update on public.payments
for each row execute function public.protect_dds_chain_payment();

create or replace function public.save_dds_payment_chain(
 p_chain_id uuid, p_expected_revision integer, p_draft jsonb,
 p_entries jsonb, p_origin_ids uuid[] default '{}', p_cancel boolean default false
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_revision integer; v_new_revision integer; v_item jsonb; v_origin uuid;
 v_previous_setting text;
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
revoke all on function public.protect_dds_chain_payment() from public;
revoke all on function public.save_dds_payment_chain(uuid,integer,jsonb,jsonb,uuid[],boolean) from public;
grant execute on function public.save_dds_payment_chain(uuid,integer,jsonb,jsonb,uuid[],boolean) to service_role;
notify pgrst, 'reload schema';
