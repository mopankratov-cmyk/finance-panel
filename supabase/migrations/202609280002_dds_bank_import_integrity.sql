-- Сохраняет каноническую связь платежа после перепривязки дубля, не даёт
-- провести односторонний перевод и исправляет уже найденные данные выписок.
set lock_timeout = '5s';

create or replace function public.sync_bank_payment_allocation() returns trigger
language plpgsql security definer set search_path=public as $$
declare
  v_review_id uuid;
  v_transaction_id uuid;
  v_role text;
  v_chain_id uuid;
  v_chain_revision integer;
  v_allocation_id uuid;
  v_status text;
  v_company_id uuid;
begin
  if new.import_source ~ '^bank-review:[0-9a-f-]{36}(:|$)' then
    v_review_id:=substring(new.import_source from '^bank-review:([0-9a-f-]{36})')::uuid;
    v_role:='ordinary';
  elsif new.import_source ~ '^dds-chain:[0-9a-f-]{36}:' then
    v_chain_id:=substring(new.import_source from '^dds-chain:([0-9a-f-]{36}):')::uuid;
    v_review_id:=v_chain_id;
    v_role:='chain';
    select entry.revision,
           case when entry.role='legacy' then 'legacy' else entry.role end,
           entry.allocation_id
      into v_chain_revision,v_role,v_allocation_id
    from public.finance_payment_chain_entries entry
    where entry.payment_id=new.id
    order by entry.revision desc
    limit 1;
    v_role:=coalesce(v_role,'chain');
  else
    return new;
  end if;

  select id into v_transaction_id
  from public.finance_bank_transactions
  where review_item_id=v_review_id;
  if v_transaction_id is null then return new; end if;

  v_status:=case when new.status='done' then 'done' when new.status='cancelled' then 'cancelled' end;
  if v_status is null or new.account_id is null or new.amount=0 or nullif(new.category,'') is null then
    delete from public.finance_bank_allocations where payment_id=new.id;
    return new;
  end if;
  select id into v_company_id from public.companies where id=new.company_id;

  insert into public.finance_bank_allocations(
    transaction_id,payment_id,chain_id,chain_revision,allocation_id,role,
    amount,operation_date,category,account_id,company_id,counterparty,status
  ) values (
    v_transaction_id,new.id,v_chain_id,v_chain_revision,v_allocation_id,v_role,
    new.amount,new.date,coalesce(new.category,''),new.account_id,v_company_id,coalesce(new.counterparty,''),v_status
  ) on conflict(payment_id) do update set
    transaction_id=excluded.transaction_id,
    chain_id=excluded.chain_id,
    chain_revision=excluded.chain_revision,
    allocation_id=excluded.allocation_id,
    role=excluded.role,
    amount=excluded.amount,
    operation_date=excluded.operation_date,
    category=excluded.category,
    account_id=excluded.account_id,
    company_id=excluded.company_id,
    counterparty=excluded.counterparty,
    status=excluded.status,
    updated_at=now();
  return new;
end $$;

-- Если один и тот же факт был перепривязан с отклонённого дубля на
-- каноническую строку, существующая allocation тоже должна сменить оригинал.
with payment_reviews as (
  select payment.id payment_id,
         case
           when payment.import_source ~ '^bank-review:[0-9a-f-]{36}(:|$)'
             then substring(payment.import_source from '^bank-review:([0-9a-f-]{36})')::uuid
           when payment.import_source ~ '^dds-chain:[0-9a-f-]{36}:'
             then substring(payment.import_source from '^dds-chain:([0-9a-f-]{36}):')::uuid
         end review_id
  from public.payments payment
  where payment.import_source ~ '^(bank-review:[0-9a-f-]{36}(:|$)|dds-chain:[0-9a-f-]{36}:)'
), canonical as (
  select payment_reviews.payment_id,transaction.id transaction_id
  from payment_reviews
  join public.finance_bank_transactions transaction on transaction.review_item_id=payment_reviews.review_id
)
update public.finance_bank_allocations allocation
set transaction_id=canonical.transaction_id,updated_at=now()
from canonical
where allocation.payment_id=canonical.payment_id
  and allocation.transaction_id is distinct from canonical.transaction_id;

update public.finance_bank_allocations allocation
set chain_id=entry.chain_id,
    chain_revision=entry.revision,
    allocation_id=entry.allocation_id,
    role=case when entry.role='legacy' then 'legacy' else entry.role end,
    updated_at=now()
from public.finance_payment_chain_entries entry
where entry.payment_id=allocation.payment_id
  and row(allocation.chain_id,allocation.chain_revision,allocation.allocation_id,allocation.role)
      is distinct from row(entry.chain_id,entry.revision,entry.allocation_id,case when entry.role='legacy' then 'legacy' else entry.role end);

-- Обычный платёж exact bank-review:<id> представляет только одну сторону.
-- Для технического перевода он допустим лишь после связи встречной строки.
-- Ручная операция «Перевод между кошельками» создаёт несколько :split: строк
-- и поэтому проходит эту проверку после выбора второго кошелька.
create or replace function public.guard_unmatched_bank_transfer_payment() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_review_id uuid;
begin
  if new.status='done'
     and new.import_source ~ '^bank-review:[0-9a-f-]{36}$'
     and new.category in ('Выбытие — Перевод между счетами','Поступление — Перевод между счетами') then
    v_review_id:=substring(new.import_source from '^bank-review:([0-9a-f-]{36})$')::uuid;
    if exists(
      select 1 from public.bank_review_items review
      where review.id=v_review_id and review.matched_transfer_id is null
    ) then
      raise exception 'Укажите второй кошелёк перевода или загрузите встречную выписку'
        using errcode='22023';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists guard_unmatched_bank_transfer_payment on public.payments;
create trigger guard_unmatched_bank_transfer_payment
before insert or update of status,category,import_source on public.payments
for each row execute function public.guard_unmatched_bank_transfer_payment();

-- Название банка берём из уже подтверждённого кошелька этого расчётного счёта.
update public.finance_bank_statements statement
set bank_name=case
      when lower(account.name) like '%ozon%' or lower(account.name) like '%озон%' then 'Ozon Банк'
      when lower(account.name) like '%точк%' then 'Банк Точка'
      when lower(account.name) like '%тинькофф%' or lower(account.name) like '%т-банк%' then 'Т-Банк'
      when lower(account.name) like '%сбер%' then 'СберБанк'
      when lower(account.name) like '%вб%' or lower(account.name) like '%wildberries%' then 'ВБ Банк'
      else statement.bank_name
    end,
    updated_at=now()
from public.bank_account_mappings mapping
join public.accounts account on account.id::text=mapping.account_id
where mapping.bank_account_number=statement.bank_account_number;

-- Этот файл содержит только список операций. Нулевых остатков в нём нет,
-- поэтому прежние 0 были выдуманным значением парсера.
update public.finance_bank_statements
set bank_name='Банк Точка',opening_balance=null,closing_balance=null,updated_at=now()
where id='1b865aa1-74eb-4691-80b0-7bb28ce34671'::uuid;

do $$
begin
  if exists (
    select 1
    from public.finance_bank_allocations allocation
    join public.payments payment on payment.id=allocation.payment_id
    join public.finance_bank_transactions transaction on transaction.id=allocation.transaction_id
    where payment.import_source ~ '^(bank-review|dds-chain):[0-9a-f-]{36}(:|$)'
      and transaction.review_item_id is distinct from
          substring(payment.import_source from '^[^:]+:([0-9a-f-]{36})')::uuid
  ) then
    raise exception 'Остались распределения, привязанные не к канонической банковской операции';
  end if;
end $$;

revoke all on function public.sync_bank_payment_allocation() from public;
revoke all on function public.guard_unmatched_bank_transfer_payment() from public;
notify pgrst,'reload schema';
