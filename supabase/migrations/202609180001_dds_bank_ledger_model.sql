-- Канонический слой банковского ДДС.
-- bank_review_items остаётся очередью проверки, payments — совместимой витриной фактов.
-- Оригинал выписки и его распределения больше не кодируются только строками import_source/comment.

create table if not exists public.finance_bank_statements (
  id uuid primary key default gen_random_uuid(),
  document_hash text not null unique,
  bank_name text not null default 'Банк не определён',
  source_file_name text not null default 'Банковская выписка',
  owner_name text not null default '',
  owner_inn text not null default '',
  bank_account_number text not null default '',
  date_from date,
  date_to date,
  opening_balance numeric,
  closing_balance numeric,
  declared_debit numeric not null default 0,
  declared_credit numeric not null default 0,
  operation_count integer not null default 0 check (operation_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_bank_transactions (
  id uuid primary key,
  review_item_id uuid not null unique references public.bank_review_items(id) on delete cascade,
  operation_identity text,
  operation_date date not null,
  amount numeric not null check (amount <> 0),
  document_number text not null default '',
  purpose text not null default '',
  counterparty text not null default '',
  counterparty_inn text not null default '',
  counterparty_account text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists finance_bank_transactions_identity_unique
  on public.finance_bank_transactions(operation_identity)
  where operation_identity is not null and operation_identity <> '';
create index if not exists finance_bank_transactions_date_idx
  on public.finance_bank_transactions(operation_date, id);

create table if not exists public.finance_bank_statement_rows (
  statement_id uuid not null references public.finance_bank_statements(id) on delete cascade,
  transaction_id uuid not null references public.finance_bank_transactions(id) on delete cascade,
  external_id text not null,
  created_at timestamptz not null default now(),
  primary key(statement_id, external_id),
  unique(statement_id, transaction_id)
);
create index if not exists finance_bank_statement_rows_transaction_idx
  on public.finance_bank_statement_rows(transaction_id);

create table if not exists public.finance_bank_allocations (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.finance_bank_transactions(id) on delete cascade,
  payment_id uuid not null unique references public.payments(id) on delete cascade,
  chain_id uuid,
  chain_revision integer,
  allocation_id uuid,
  role text not null check (role in ('ordinary','source','cash-in','loan-out','loan-in','transfer-in','spending','legacy','chain')),
  amount numeric not null check (amount <> 0),
  operation_date date not null,
  category text not null,
  account_id uuid not null references public.accounts(id) on delete restrict,
  company_id uuid references public.companies(id) on delete restrict,
  counterparty text not null default '',
  status text not null check (status in ('done','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists finance_bank_allocations_transaction_idx
  on public.finance_bank_allocations(transaction_id, status, role);
create index if not exists finance_bank_allocations_chain_idx
  on public.finance_bank_allocations(chain_id, chain_revision);

alter table public.finance_bank_statements enable row level security;
alter table public.finance_bank_transactions enable row level security;
alter table public.finance_bank_statement_rows enable row level security;
alter table public.finance_bank_allocations enable row level security;
revoke all on public.finance_bank_statements, public.finance_bank_transactions, public.finance_bank_statement_rows, public.finance_bank_allocations from anon, authenticated;
grant all on public.finance_bank_statements, public.finance_bank_transactions, public.finance_bank_statement_rows, public.finance_bank_allocations to service_role;

-- Массовая очистка банковского импорта удаляет review items. Каскад убирает
-- операции и строки, а этот триггер не оставляет пустые карточки файлов.
create or replace function public.cleanup_empty_finance_bank_statement() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  delete from public.finance_bank_statements s where s.id=old.statement_id
    and not exists(select 1 from public.finance_bank_statement_rows r where r.statement_id=s.id);
  return old;
end $$;
drop trigger if exists cleanup_empty_finance_bank_statement on public.finance_bank_statement_rows;
create trigger cleanup_empty_finance_bank_statement
after delete on public.finance_bank_statement_rows
for each row execute function public.cleanup_empty_finance_bank_statement();

create or replace function public.dds_reason_value(p_reasons jsonb, p_prefix text) returns text
language sql immutable parallel safe as $$
  select substring(value from length(p_prefix) + 1)
  from jsonb_array_elements_text(coalesce(p_reasons, '[]'::jsonb)) value
  where value like p_prefix || '%'
  limit 1
$$;

-- Совместимость: любая новая строка старой очереди сразу получает канонический оригинал.
create or replace function public.sync_bank_review_item_to_ledger() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_statement_id uuid;
begin
  insert into public.finance_bank_statements(
    document_hash, source_file_name, owner_inn, bank_account_number,
    date_from, date_to, declared_debit, declared_credit, operation_count
  ) values (
    new.document_hash, new.source_file_name, new.owner_inn, new.bank_account_number,
    new.date, new.date, greatest(-new.amount, 0), greatest(new.amount, 0), 1
  )
  on conflict(document_hash) do update set
    date_from=least(finance_bank_statements.date_from, excluded.date_from),
    date_to=greatest(finance_bank_statements.date_to, excluded.date_to),
    updated_at=now()
  returning id into v_statement_id;

  insert into public.finance_bank_transactions(
    id, review_item_id, operation_identity,
    operation_date, amount, purpose, counterparty, counterparty_inn, counterparty_account
  ) values (
    new.id, new.id,
    public.dds_reason_value(new.reasons, '__operation_identity:'),
    new.date, new.amount, new.purpose, new.counterparty, new.counterparty_inn,
    coalesce(public.dds_reason_value(new.reasons, '__counterparty_account:'), '')
  ) on conflict(review_item_id) do nothing;
  insert into public.finance_bank_statement_rows(statement_id,transaction_id,external_id)
  values(v_statement_id,new.id,new.external_id)
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists sync_bank_review_item_to_ledger on public.bank_review_items;
create trigger sync_bank_review_item_to_ledger
after insert on public.bank_review_items
for each row execute function public.sync_bank_review_item_to_ledger();

-- Метаданные файла и поля, которых историческая очередь не хранила.
create or replace function public.register_finance_bank_statement(p_statement jsonb, p_transactions jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_statement_id uuid; v_transaction_id uuid; v_item jsonb; v_count integer:=0;
begin
  if jsonb_typeof(p_statement) is distinct from 'object'
     or jsonb_typeof(p_transactions) is distinct from 'array'
     or jsonb_array_length(p_transactions) > 10000 then
    raise exception 'Некорректная банковская выписка' using errcode='22023';
  end if;
  insert into public.finance_bank_statements(
    document_hash, bank_name, source_file_name, owner_name, owner_inn, bank_account_number,
    date_from, date_to, opening_balance, closing_balance, declared_debit, declared_credit, operation_count
  ) values (
    p_statement->>'documentHash', coalesce(nullif(p_statement->>'bank',''),'Банк не определён'),
    coalesce(nullif(p_statement->>'sourceFileName',''),'Банковская выписка'), coalesce(p_statement->>'owner',''),
    coalesce(p_statement->>'ownerInn',''), coalesce(p_statement->>'accountNumber',''),
    nullif(p_statement->>'dateFrom','')::date, nullif(p_statement->>'dateTo','')::date,
    nullif(p_statement->>'openingBalance','')::numeric, nullif(p_statement->>'closingBalance','')::numeric,
    coalesce((p_statement->>'declaredDebit')::numeric,0), coalesce((p_statement->>'declaredCredit')::numeric,0),
    coalesce((p_statement->>'operationCount')::integer,0)
  ) on conflict(document_hash) do update set
    bank_name=excluded.bank_name, source_file_name=excluded.source_file_name,
    owner_name=excluded.owner_name, owner_inn=excluded.owner_inn, bank_account_number=excluded.bank_account_number,
    date_from=excluded.date_from, date_to=excluded.date_to, opening_balance=excluded.opening_balance,
    closing_balance=excluded.closing_balance, declared_debit=excluded.declared_debit,
    declared_credit=excluded.declared_credit, operation_count=excluded.operation_count, updated_at=now()
  returning id into v_statement_id;

  for v_item in select value from jsonb_array_elements(p_transactions) loop
    insert into public.finance_bank_transactions(
      id, review_item_id, operation_identity, operation_date, amount,
      document_number, purpose, counterparty, counterparty_inn, counterparty_account
    ) values (
      (v_item->>'reviewItemId')::uuid, (v_item->>'reviewItemId')::uuid,
      nullif(v_item->>'operationIdentity',''), (v_item->>'date')::date,
      (v_item->>'amount')::numeric, coalesce(v_item->>'documentNumber',''), coalesce(v_item->>'purpose',''),
      coalesce(v_item->>'counterparty',''), coalesce(v_item->>'counterpartyInn',''),
      coalesce(v_item->>'counterpartyAccount','')
    ) on conflict(review_item_id) do update set
      operation_identity=coalesce(excluded.operation_identity,finance_bank_transactions.operation_identity),
      document_number=case when finance_bank_transactions.document_number='' then excluded.document_number else finance_bank_transactions.document_number end,
      counterparty_account=case when finance_bank_transactions.counterparty_account='' then excluded.counterparty_account else finance_bank_transactions.counterparty_account end
    returning id into v_transaction_id;
    insert into public.finance_bank_statement_rows(statement_id,transaction_id,external_id)
    values(v_statement_id,v_transaction_id,v_item->>'externalId')
    on conflict do nothing;
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('statementId',v_statement_id,'transactions',v_count);
end $$;
revoke all on function public.register_finance_bank_statement(jsonb,jsonb) from public;
grant execute on function public.register_finance_bank_statement(jsonb,jsonb) to service_role;

create or replace function public.sync_bank_payment_allocation() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_review_id uuid; v_transaction_id uuid; v_role text; v_chain_id uuid;
begin
  if new.import_source ~ '^bank-review:[0-9a-f-]{36}$' then
    v_review_id:=substring(new.import_source from '^bank-review:([0-9a-f-]{36})$')::uuid;
    v_role:='ordinary';
  elsif new.import_source ~ '^dds-chain:[0-9a-f-]{36}:' then
    v_chain_id:=substring(new.import_source from '^dds-chain:([0-9a-f-]{36}):')::uuid;
    v_review_id:=v_chain_id;
    v_role:='chain';
  else
    return new;
  end if;
  select id into v_transaction_id from public.finance_bank_transactions where review_item_id=v_review_id;
  if v_transaction_id is null then return new; end if;
  insert into public.finance_bank_allocations(
    transaction_id,payment_id,chain_id,role,amount,operation_date,category,account_id,company_id,counterparty,status
  ) values (
    v_transaction_id,new.id,v_chain_id,v_role,new.amount,new.date,new.category,new.account_id,new.company_id,
    coalesce(new.counterparty,''),case when new.status='cancelled' then 'cancelled' else 'done' end
  ) on conflict(payment_id) do update set
    amount=excluded.amount,operation_date=excluded.operation_date,category=excluded.category,
    account_id=excluded.account_id,company_id=excluded.company_id,counterparty=excluded.counterparty,
    status=excluded.status,updated_at=now();
  return new;
end $$;
drop trigger if exists sync_bank_payment_allocation on public.payments;
create trigger sync_bank_payment_allocation
after insert or update of amount,date,category,account_id,company_id,counterparty,status,import_source on public.payments
for each row execute function public.sync_bank_payment_allocation();

create or replace function public.sync_bank_chain_entry_allocation() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  update public.finance_bank_allocations set
    chain_id=new.chain_id, chain_revision=new.revision, allocation_id=new.allocation_id,
    role=case when new.role='legacy' then 'legacy' else new.role end, updated_at=now()
  where payment_id=new.payment_id;
  return new;
end $$;
drop trigger if exists sync_bank_chain_entry_allocation on public.finance_payment_chain_entries;
create trigger sync_bank_chain_entry_allocation
after insert or update on public.finance_payment_chain_entries
for each row execute function public.sync_bank_chain_entry_allocation();

-- Исторический перенос. Сначала оригиналы, затем уже проведённые факты и роли цепочек.
insert into public.finance_bank_statements(
  document_hash,source_file_name,owner_inn,bank_account_number,date_from,date_to,
  declared_debit,declared_credit,operation_count
)
select document_hash,min(source_file_name),min(owner_inn),min(bank_account_number),min(date),max(date),
       sum(greatest(-amount,0)),sum(greatest(amount,0)),count(*)
from public.bank_review_items group by document_hash
on conflict(document_hash) do nothing;

insert into public.finance_bank_transactions(
  id,review_item_id,operation_identity,operation_date,amount,
  purpose,counterparty,counterparty_inn,counterparty_account
)
select r.id,r.id,public.dds_reason_value(r.reasons,'__operation_identity:'),r.date,r.amount,
       r.purpose,r.counterparty,r.counterparty_inn,coalesce(public.dds_reason_value(r.reasons,'__counterparty_account:'),'')
from public.bank_review_items r
on conflict(review_item_id) do nothing;

insert into public.finance_bank_statement_rows(statement_id,transaction_id,external_id)
select s.id,t.id,r.external_id
from public.bank_review_items r
join public.finance_bank_statements s on s.document_hash=r.document_hash
join public.finance_bank_transactions t on t.review_item_id=r.id
on conflict(statement_id,external_id) do nothing;

-- Контроль до/после входит в ту же транзакцию миграции. При потере хотя бы
-- одной строки или копейки PostgreSQL откатит весь перенос, а старые таблицы
-- останутся источником данных без частично заполненной новой модели.
do $$
declare
  v_review_count bigint;
  v_transaction_count bigint;
  v_statement_row_count bigint;
  v_review_amount numeric;
  v_transaction_amount numeric;
begin
  select count(*), coalesce(sum(amount), 0)
    into v_review_count, v_review_amount from public.bank_review_items;
  select count(*), coalesce(sum(amount), 0)
    into v_transaction_count, v_transaction_amount from public.finance_bank_transactions;
  select count(*) into v_statement_row_count from public.finance_bank_statement_rows;
  if v_review_count <> v_transaction_count or v_review_count <> v_statement_row_count
     or v_review_amount <> v_transaction_amount then
    raise exception 'Контроль переноса ДДС не пройден: очередь % / операции % / строки выписок %, сумма % / %',
      v_review_count, v_transaction_count, v_statement_row_count, v_review_amount, v_transaction_amount;
  end if;
end $$;

insert into public.finance_bank_allocations(
  transaction_id,payment_id,chain_id,role,amount,operation_date,category,account_id,company_id,counterparty,status
)
select t.id,p.id,
       case when p.import_source ~ '^dds-chain:[0-9a-f-]{36}:' then substring(p.import_source from '^dds-chain:([0-9a-f-]{36}):')::uuid end,
       case when p.import_source ~ '^bank-review:[0-9a-f-]{36}$' then 'ordinary' else 'chain' end,
       p.amount,p.date,p.category,p.account_id,p.company_id,coalesce(p.counterparty,''),
       case when p.status='cancelled' then 'cancelled' else 'done' end
from public.payments p
join public.finance_bank_transactions t on t.review_item_id=
  case
    when p.import_source ~ '^bank-review:[0-9a-f-]{36}$' then substring(p.import_source from '^bank-review:([0-9a-f-]{36})$')::uuid
    when p.import_source ~ '^dds-chain:[0-9a-f-]{36}:' then substring(p.import_source from '^dds-chain:([0-9a-f-]{36}):')::uuid
  end
where p.import_source ~ '^(bank-review|dds-chain):[0-9a-f-]{36}'
on conflict(payment_id) do nothing;

update public.finance_bank_allocations a set
  chain_id=e.chain_id,chain_revision=e.revision,allocation_id=e.allocation_id,
  role=case when e.role='legacy' then 'legacy' else e.role end,updated_at=now()
from public.finance_payment_chain_entries e where e.payment_id=a.payment_id;

create or replace view public.finance_bank_transaction_reconciliation as
select
  t.id as transaction_id,t.review_item_id,t.operation_date,t.amount as source_amount,r.status as review_status,
  count(a.id) filter(where a.status='done') as active_allocation_count,
  coalesce(sum(a.amount) filter(where a.status='done' and a.role in('ordinary','source')),0) as allocated_bank_amount,
  t.amount-coalesce(sum(a.amount) filter(where a.status='done' and a.role in('ordinary','source')),0) as difference,
  case
    when r.status<>'approved' then 'pending'
    when count(a.id) filter(where a.status='done' and a.role in('ordinary','source'))=0 then 'missing'
    when t.amount=coalesce(sum(a.amount) filter(where a.status='done' and a.role in('ordinary','source')),0) then 'ok'
    else 'mismatch'
  end as reconciliation_status
from public.finance_bank_transactions t
join public.bank_review_items r on r.id=t.review_item_id
left join public.finance_bank_allocations a on a.transaction_id=t.id
group by t.id,t.review_item_id,t.operation_date,t.amount,r.status;
revoke all on public.finance_bank_transaction_reconciliation from anon, authenticated;
grant select on public.finance_bank_transaction_reconciliation to service_role;

create or replace function public.finance_bank_ledger_control() returns jsonb
language sql security definer set search_path=public as $$
  select jsonb_build_object(
    'reviewCount',(select count(*) from public.bank_review_items),
    'reviewAmount',(select coalesce(sum(amount),0) from public.bank_review_items),
    'transactionCount',(select count(*) from public.finance_bank_transactions),
    'transactionAmount',(select coalesce(sum(amount),0) from public.finance_bank_transactions),
    'sourceCountDifference',(select count(*) from public.bank_review_items)-(select count(*) from public.finance_bank_transactions),
    'sourceAmountDifference',(select coalesce(sum(amount),0) from public.bank_review_items)-(select coalesce(sum(amount),0) from public.finance_bank_transactions),
    'unprojectedCount',(select count(*) from public.bank_review_items r where not exists(select 1 from public.finance_bank_transactions t where t.review_item_id=r.id)),
    'statementMismatchCount',(select count(*) from public.finance_bank_statements s where
      s.operation_count<>(select count(*) from public.finance_bank_statement_rows sr where sr.statement_id=s.id)
      or s.declared_debit<>(select coalesce(sum(greatest(-t.amount,0)),0) from public.finance_bank_statement_rows sr join public.finance_bank_transactions t on t.id=sr.transaction_id where sr.statement_id=s.id)
      or s.declared_credit<>(select coalesce(sum(greatest(t.amount,0)),0) from public.finance_bank_statement_rows sr join public.finance_bank_transactions t on t.id=sr.transaction_id where sr.statement_id=s.id)),
    'approvedCount',(select count(*) from public.bank_review_items where status='approved'),
    'allocationCount',(select count(*) from public.finance_bank_allocations),
    'missingApprovedCount',(select count(*) from public.finance_bank_transaction_reconciliation where reconciliation_status='missing'),
    'mismatchCount',(select count(*) from public.finance_bank_transaction_reconciliation where reconciliation_status='mismatch'),
    'mismatchAmount',(select coalesce(sum(difference),0) from public.finance_bank_transaction_reconciliation where reconciliation_status='mismatch')
  )
$$;
revoke all on function public.finance_bank_ledger_control() from public;
grant execute on function public.finance_bank_ledger_control() to service_role;

notify pgrst,'reload schema';
