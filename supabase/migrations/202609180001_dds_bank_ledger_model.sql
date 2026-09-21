-- Канонический слой банковского ДДС.
-- bank_review_items остаётся очередью проверки, payments — совместимой витриной фактов.
-- Оригинал выписки и его распределения больше не кодируются только строками import_source/comment.
--
-- Вторая редакция (после адверсариального разбора первой, до применения в бою):
-- заякорены все regex-сопоставления import_source (иначе части разбитых
-- операций и исторический формат bank-review:<id>:<n> молча выпадали из
-- переноса), ограничения канонических таблиц смягчены до уровня источника
-- (иначе один платёж без категории/счёта роняет весь перенос или обычное
-- сохранение платежа), operation_count/declared_* выписки не пишутся из
-- построчного триггера (иначе счётчик навсегда врёт), контрольный блок
-- сравнивает реальный денежный слой, а не таблицу с её же копией, добавлен
-- триггер на удаление платежа и статья исключений для "Очистить импорт".
--
-- Применять с set lock_timeout — DDL ниже берёт ACCESS EXCLUSIVE на payments
-- и bank_review_items на весь прогон; при активной работе панели лучше явный
-- быстрый отказ, чем зависшая транзакция.
set lock_timeout = '5s';

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
  declared_debit numeric,
  declared_credit numeric,
  operation_count integer,
  -- NULL = карточка создана построчным триггером и содержит только грубую
  -- оценку по первой попавшейся строке; заполняется настоящими значениями
  -- только через register_finance_bank_statement (реальная шапка файла) —
  -- контроль ниже сравнивает только "зарегистрированные" выписки, иначе
  -- каждая карточка навсегда висит в расхождении по построению.
  registered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_bank_transactions (
  id uuid primary key,
  review_item_id uuid not null unique references public.bank_review_items(id) on delete cascade,
  operation_identity text,
  operation_date date not null,
  -- Без check (amount <> 0): bank_review_items.amount такого ограничения не
  -- несёт (банк может прислать техническую нулевую строку), а зеркальная
  -- таблица не должна быть строже источника — иначе любая такая строка
  -- роняет весь перенос или весь новый импорт с 500 вместо тихого пропуска.
  amount numeric not null,
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
  amount numeric not null,
  operation_date date not null,
  -- category/account_id без not null и без строгого FK на companies: платёж
  -- в payments может быть без категории, без company_id или со ссылкой на
  -- удалённую компанию (там ни NOT NULL, ни FK на companies никогда не было
  -- объявлено) — зеркальная таблица не должна из-за этого ронять ни перенос,
  -- ни обычное сохранение платежа. account_id — cascade, а не restrict: он
  -- уже наследует судьбу payments.account_id (тоже cascade), так что порядок
  -- срабатывания каскадов не имеет значения, и удаление кошелька не падает
  -- по FK там, где раньше просто сносило платежи вместе со счётом.
  category text not null default '',
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
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
-- Statement-level (не построчный): "Очистить импорт" сносит очередь одним
-- delete на тысячи строк — построчный триггер давал бы ~4 лишних запроса на
-- каждую из них и рисковал упереться в statement_timeout PostgREST.
create or replace function public.cleanup_empty_finance_bank_statements() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  delete from public.finance_bank_statements s
  where not exists(select 1 from public.finance_bank_statement_rows r where r.statement_id=s.id);
  return null;
end $$;
drop trigger if exists cleanup_empty_finance_bank_statement on public.finance_bank_statement_rows;
drop trigger if exists cleanup_empty_finance_bank_statements on public.finance_bank_statement_rows;
create trigger cleanup_empty_finance_bank_statements
after delete on public.finance_bank_statement_rows
for each statement execute function public.cleanup_empty_finance_bank_statements();

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
declare v_statement_id uuid; v_transaction_id uuid; v_identity text;
begin
  -- declared_debit/declared_credit/operation_count здесь НЕ заполняются —
  -- построчный триггер видит только одну строку за раз и при повторных
  -- вставках того же файла (on conflict) их не пересчитывает. Настоящие
  -- значения приходят одним вызовом register_finance_bank_statement (шапка
  -- файла целиком) и помечаются registered_at — контроль ниже сравнивает
  -- только зарегистрированные выписки, а не эту грубую заглушку.
  insert into public.finance_bank_statements(
    document_hash, source_file_name, owner_inn, bank_account_number, date_from, date_to
  ) values (
    new.document_hash, new.source_file_name, new.owner_inn, new.bank_account_number, new.date, new.date
  )
  on conflict(document_hash) do update set
    date_from=least(finance_bank_statements.date_from, excluded.date_from),
    date_to=greatest(finance_bank_statements.date_to, excluded.date_to),
    updated_at=now()
  returning id into v_statement_id;

  v_identity := public.dds_reason_value(new.reasons, '__operation_identity:');
  insert into public.finance_bank_transactions(
    id, review_item_id, operation_identity,
    operation_date, amount, purpose, counterparty, counterparty_inn, counterparty_account
  ) values (
    new.id, new.id, v_identity,
    new.date, new.amount, new.purpose, new.counterparty, new.counterparty_inn,
    coalesce(public.dds_reason_value(new.reasons, '__counterparty_account:'), '')
  ) on conflict do nothing; -- покрывает и review_item_id, и частичный индекс по operation_identity
  -- Если конфликт был по operation_identity (дубль строки, идентичный уже
  -- существующей операции — двойная перекрывающаяся загрузка в узком окне
  -- до применения этой миграции), вставка выше молча пропущена и строки с
  -- id=new.id в finance_bank_transactions нет: нельзя слепо использовать
  -- new.id как transaction_id — найдём настоящего владельца идентичности.
  select id into v_transaction_id from public.finance_bank_transactions where review_item_id=new.id;
  if v_transaction_id is null and v_identity is not null then
    select id into v_transaction_id from public.finance_bank_transactions where operation_identity=v_identity;
  end if;
  if v_transaction_id is null then return new; end if;
  insert into public.finance_bank_statement_rows(statement_id,transaction_id,external_id)
  values(v_statement_id,v_transaction_id,new.external_id)
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists sync_bank_review_item_to_ledger on public.bank_review_items;
create trigger sync_bank_review_item_to_ledger
after insert on public.bank_review_items
for each row execute function public.sync_bank_review_item_to_ledger();

-- Метаданные файла и поля, которых историческая очередь не хранила.
-- operation_count считается от реально зарегистрированных транзакций
-- (p_transactions), а не от сырых строк файла — иначе любая отфильтрованная
-- клиентом строка (нулевая сумма, неразобранная дата, снятая галочка)
-- делает контроль красным после любого обычного импорта.
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
    date_from, date_to, opening_balance, closing_balance, declared_debit, declared_credit, operation_count,
    registered_at
  ) values (
    p_statement->>'documentHash', coalesce(nullif(p_statement->>'bank',''),'Банк не определён'),
    coalesce(nullif(p_statement->>'sourceFileName',''),'Банковская выписка'), coalesce(p_statement->>'owner',''),
    coalesce(p_statement->>'ownerInn',''), coalesce(p_statement->>'accountNumber',''),
    nullif(p_statement->>'dateFrom','')::date, nullif(p_statement->>'dateTo','')::date,
    nullif(p_statement->>'openingBalance','')::numeric, nullif(p_statement->>'closingBalance','')::numeric,
    coalesce((p_statement->>'declaredDebit')::numeric,0), coalesce((p_statement->>'declaredCredit')::numeric,0),
    jsonb_array_length(p_transactions), now()
  ) on conflict(document_hash) do update set
    bank_name=excluded.bank_name, source_file_name=excluded.source_file_name,
    owner_name=excluded.owner_name, owner_inn=excluded.owner_inn, bank_account_number=excluded.bank_account_number,
    date_from=excluded.date_from, date_to=excluded.date_to, opening_balance=excluded.opening_balance,
    closing_balance=excluded.closing_balance, declared_debit=excluded.declared_debit,
    declared_credit=excluded.declared_credit, operation_count=excluded.operation_count,
    registered_at=now(), updated_at=now()
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

-- Платёж → распределение. Один якорь на все три исторических формата
-- import_source: 'bank-review:<uuid>' целиком, 'bank-review:<uuid>:split:N'
-- (текущий формат разбивки, BankReviewPanel.tsx) и исторический
-- 'bank-review:<uuid>:<n>' (до переименования в :split:) — все три относятся
-- к ОДНОЙ банковской операции <uuid> и раньше эту операцию находили
-- (confirm_bank_review_items, paymentChainsServer.ts, chainIdForPayment).
-- Общий regex без якоря $ ловит все три сразу, поэтому отдельная ветка для
-- split-формата не нужна.
create or replace function public.sync_bank_payment_allocation() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_review_id uuid; v_transaction_id uuid; v_role text; v_chain_id uuid; v_status text; v_company_id uuid;
begin
  if new.import_source ~ '^bank-review:[0-9a-f-]{36}(:|$)' then
    v_review_id:=substring(new.import_source from '^bank-review:([0-9a-f-]{36})')::uuid;
    v_role:='ordinary';
  elsif new.import_source ~ '^dds-chain:[0-9a-f-]{36}:' then
    v_chain_id:=substring(new.import_source from '^dds-chain:([0-9a-f-]{36}):')::uuid;
    v_review_id:=v_chain_id;
    v_role:='chain'; -- временная роль; update ниже по finance_payment_chain_entries тут же ставит настоящую
  else
    return new;
  end if;
  select id into v_transaction_id from public.finance_bank_transactions where review_item_id=v_review_id;
  if v_transaction_id is null then return new; end if;

  -- План — ещё не факт ДДС (isDdsActualPayment требует status='done', см.
  -- lib/finance/bankDdsPayment.ts). Раньше триггер писал ЛЮБОЙ не-cancelled
  -- статус как 'done', то есть план смешивался с фактом. Если у платежа уже
  -- была аллокация (был 'done', откатили в 'planned'), снимаем её — иначе
  -- она продолжит числиться проведённой.
  v_status := case when new.status='done' then 'done' when new.status='cancelled' then 'cancelled' end;
  if v_status is null
     or new.account_id is null or new.amount = 0 or nullif(new.category,'') is null then
    delete from public.finance_bank_allocations where payment_id=new.id;
    return new;
  end if;
  select id into v_company_id from public.companies where id=new.company_id;

  insert into public.finance_bank_allocations(
    transaction_id,payment_id,chain_id,role,amount,operation_date,category,account_id,company_id,counterparty,status
  ) values (
    v_transaction_id,new.id,v_chain_id,v_role,new.amount,new.date,coalesce(new.category,''),new.account_id,v_company_id,
    coalesce(new.counterparty,''),v_status
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

-- Удаление банковского платежа раньше не трогало очередь: payment_id cascade
-- сносил finance_bank_allocations, но bank_review_items оставался 'approved'
-- без единой проведённой суммы — вьюха классифицировала это как 'missing'
-- навсегда, а вернуть строку в очередь из интерфейса было нечем.
create or replace function public.release_bank_review_item_on_payment_delete() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_review_id uuid;
begin
  if old.import_source ~ '^bank-review:[0-9a-f-]{36}$' then
    v_review_id := substring(old.import_source from '^bank-review:([0-9a-f-]{36})$')::uuid;
    update public.bank_review_items set status='ready', updated_at=now()
      where id=v_review_id and status='approved'
        and not exists(select 1 from public.payments p where p.import_source=old.import_source and p.id<>old.id);
  end if;
  return old;
end $$;
drop trigger if exists release_bank_review_item_on_payment_delete on public.payments;
create trigger release_bank_review_item_on_payment_delete
after delete on public.payments
for each row execute function public.release_bank_review_item_on_payment_delete();

-- "Очистить импорт" исторически чистил только payments с import_source
-- bank-review:% — платежи-разбивки цепочки (dds-chain:<review_id>:...)
-- оставались висеть без банковского оригинала: finance_bank_allocations по
-- ним сносился каскадом вместе с bank_review_items/finance_bank_transactions,
-- и finance_bank_ledger_control() после такой очистки рапортовал "всё
-- сверено, расхождений 0" — при живых непроведённых суммах в payments.
-- Ищем и чистим платежи цепочек здесь же: id цепочки (finance_payment_chains.id)
-- совпадает с bank_review_items.id, из которого она выросла (тот же uuid,
-- что и dds-chain:<uuid>: в import_source, см. sync_bank_payment_allocation).
create or replace function public.bank_review_clear_import(
  p_payment_ids uuid[],
  p_review_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_chain_payment_ids uuid[];
begin
  select coalesce(array_agg(payment_id), '{}') into v_chain_payment_ids
    from public.finance_payment_chain_entries where chain_id = any(p_review_ids);
  delete from public.finance_payment_chain_entries where chain_id = any(p_review_ids);
  delete from public.finance_payment_chain_revisions where chain_id = any(p_review_ids);
  delete from public.finance_payment_chains where id = any(p_review_ids);
  delete from public.payments where id = any(p_payment_ids) or id = any(v_chain_payment_ids);
  delete from public.bank_review_items where id = any(p_review_ids);
end $fn$;
revoke all on function public.bank_review_clear_import(uuid[], uuid[]) from public;
grant execute on function public.bank_review_clear_import(uuid[], uuid[]) to service_role;

-- Исторический перенос. Сначала оригиналы, затем уже проведённые факты и роли цепочек.
-- declared_debit/declared_credit/operation_count для ИСТОРИЧЕСКИХ выписок
-- намеренно НЕ заполняются (остаются NULL, registered_at тоже NULL) — у нас
-- нет настоящей шапки банковского файла для старого импорта, а если считать
-- эти поля из той же очереди, что и operation_count транзакций, контроль
-- сравнивает таблицу с её отражением и не может показать ничего, кроме
-- вечного зелёного нуля.
insert into public.finance_bank_statements(document_hash,source_file_name,owner_inn,bank_account_number,date_from,date_to)
select document_hash,min(source_file_name),min(owner_inn),min(bank_account_number),min(date),max(date)
from public.bank_review_items group by document_hash
on conflict(document_hash) do nothing;

insert into public.finance_bank_transactions(
  id,review_item_id,operation_identity,operation_date,amount,
  purpose,counterparty,counterparty_inn,counterparty_account
)
select distinct on (coalesce(public.dds_reason_value(r.reasons,'__operation_identity:'), r.id::text))
       r.id,r.id,public.dds_reason_value(r.reasons,'__operation_identity:'),r.date,r.amount,
       r.purpose,r.counterparty,r.counterparty_inn,coalesce(public.dds_reason_value(r.reasons,'__counterparty_account:'),'')
from public.bank_review_items r
order by coalesce(public.dds_reason_value(r.reasons,'__operation_identity:'), r.id::text), r.id
on conflict do nothing; -- покрывает и review_item_id, и частичный индекс по identity

insert into public.finance_bank_statement_rows(statement_id,transaction_id,external_id)
select s.id,t.id,r.external_id
from public.bank_review_items r
join public.finance_bank_statements s on s.document_hash=r.document_hash
join public.finance_bank_transactions t on t.review_item_id=r.id
on conflict(statement_id,external_id) do nothing;

-- Контроль до/после входит в ту же транзакцию миграции. Раньше он сравнивал
-- count(*) очереди с count(*) операций дословно — но это (а) тавтология,
-- finance_bank_transactions.amount скопирован из bank_review_items.amount
-- тремя операторами выше и не может разойтись ни при каких данных, и (б)
-- ломается на ЗАКОННОМ дубле по operation_identity: вторая строка с той же
-- идентичностью (перекрывающаяся выписка) намеренно НЕ получает свою
-- собственную транзакцию — на неё смотрит каноническая операция первой
-- строки. Правильная проверка — не количество, а покрытие: у каждой строки
-- очереди должна найтись каноническая операция, своя или общая по
-- идентичности. Слой payments -> allocations, где реально теряются суммы,
-- эта проверка не касается — контроль денег ниже, ПОСЛЕ переноса allocations.
do $$
declare
  v_uncovered_count bigint;
begin
  select count(*) into v_uncovered_count from public.bank_review_items r
  where not exists (
    select 1 from public.finance_bank_transactions t
    where t.review_item_id=r.id
       or (t.operation_identity is not null and t.operation_identity=public.dds_reason_value(r.reasons,'__operation_identity:'))
  );
  if v_uncovered_count > 0 then
    raise exception 'Контроль переноса ДДС не пройден: % строк(и) очереди без канонической операции', v_uncovered_count;
  end if;
end $$;

insert into public.finance_bank_allocations(
  transaction_id,payment_id,chain_id,role,amount,operation_date,category,account_id,company_id,counterparty,status
)
select t.id,p.id,
       case when p.import_source ~ '^dds-chain:[0-9a-f-]{36}:' then substring(p.import_source from '^dds-chain:([0-9a-f-]{36}):')::uuid end,
       case when p.import_source ~ '^dds-chain:[0-9a-f-]{36}:' then 'chain' else 'ordinary' end,
       p.amount,p.date,coalesce(p.category,''),p.account_id,
       (select c.id from public.companies c where c.id=p.company_id),
       coalesce(p.counterparty,''),
       case when p.status='done' then 'done' when p.status='cancelled' then 'cancelled' end
from public.payments p
join public.finance_bank_transactions t on t.review_item_id=
  case
    when p.import_source ~ '^bank-review:[0-9a-f-]{36}(:|$)' then substring(p.import_source from '^bank-review:([0-9a-f-]{36})')::uuid
    when p.import_source ~ '^dds-chain:[0-9a-f-]{36}:' then substring(p.import_source from '^dds-chain:([0-9a-f-]{36}):')::uuid
  end
where p.import_source ~ '^(bank-review:[0-9a-f-]{36}(:|$)|dds-chain:[0-9a-f-]{36}:)'
  and p.status in ('done','cancelled')
  and p.account_id is not null and p.amount <> 0
on conflict(payment_id) do nothing;

update public.finance_bank_allocations a set
  chain_id=e.chain_id,chain_revision=e.revision,allocation_id=e.allocation_id,
  role=case when e.role='legacy' then 'legacy' else e.role end,updated_at=now()
from public.finance_payment_chain_entries e where e.payment_id=a.payment_id;

-- Настоящий контроль денег: платежи, которые ДОЛЖНЫ были получить
-- распределение (подходят под шаблон import_source, но не отфильтрованы
-- выше по account_id/amount/status), против того, что реально перенесено.
do $$
declare
  v_expected bigint;
  v_migrated bigint;
begin
  select count(*) into v_expected from public.payments p
    where p.import_source ~ '^(bank-review:[0-9a-f-]{36}(:|$)|dds-chain:[0-9a-f-]{36}:)'
      and p.status in ('done','cancelled') and p.account_id is not null and p.amount <> 0
      and exists(select 1 from public.finance_bank_transactions t where t.review_item_id=
        case
          when p.import_source ~ '^bank-review:[0-9a-f-]{36}(:|$)' then substring(p.import_source from '^bank-review:([0-9a-f-]{36})')::uuid
          when p.import_source ~ '^dds-chain:[0-9a-f-]{36}:' then substring(p.import_source from '^dds-chain:([0-9a-f-]{36}):')::uuid
        end);
  select count(*) into v_migrated from public.finance_bank_allocations;
  if v_expected <> v_migrated then
    raise exception 'Контроль переноса ДДС (деньги) не пройден: ожидалось распределений % / перенесено %', v_expected, v_migrated;
  end if;
end $$;

-- Знаменатель сверки — только роли, которые прямо представляют денежное
-- движение по банковскому счёту (см. lib/finance/paymentChains.ts:
-- buildChainEntries — 'source'/'ordinary' это и есть банковская сторона
-- операции что при throughCash=true, что при throughCash=false; 'cash-in',
-- 'spending', 'loan-*', 'transfer-in' — внутренние технические ноги одной
-- и той же операции, их сумма уже включена в 'source' и не должна
-- складываться поверх). has_excluded_chain_parts различает: часть суммы
-- цепочки МОГЛА быть намеренно не разнесена (allocation.excluded=true в
-- драфте) — это осознанный бизнес-случай "часть не учитываем", а не ошибка,
-- поэтому такие операции получают отдельный статус 'partial', а не 'mismatch'.
-- has_excluded_chain_parts проверяется отдельным коррелированным EXISTS, а
-- не join'ом в основной агрегации: jsonb_array_elements по драфту цепочки
-- размножает строки на число частей ("aa1","aa2",...), и если завести его
-- как left join рядом с finance_bank_allocations, sum(a.amount) в ЭТОЙ ЖЕ
-- агрегации умножается на число частей цепочки — операция на -15000 с двумя
-- частями в драфте считается как -30000. EXISTS не участвует в FROM/GROUP BY
-- основного запроса и на суммы не влияет.
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
    when exists(
      select 1 from public.finance_bank_allocations a2
      join public.finance_payment_chains c2 on c2.id=a2.chain_id
      cross join lateral jsonb_array_elements(coalesce(c2.draft->'allocations','[]'::jsonb)) chain_alloc(value)
      where a2.transaction_id=t.id and (chain_alloc.value->>'excluded')::boolean is true
    ) then 'partial'
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
  -- Строка с operation_identity, совпадающим с уже перенесённой операцией
  -- (та же банковская операция во второй, перекрывающейся выписке) — не
  -- "непроецированная": она честно делит каноническую операцию с первой
  -- строкой. Без этой оговорки штатная загрузка перекрывающегося фрагмента
  -- (docs/DDS-BANK-LEDGER-MIGRATION.md, шаг приёмки 4) красит контроль, хотя
  -- по нему обещано, что он останется зелёным.
  with uncovered as (
    select r.id, r.amount from public.bank_review_items r where not exists(
      select 1 from public.finance_bank_transactions t
      where t.review_item_id=r.id
         or (t.operation_identity is not null and t.operation_identity=public.dds_reason_value(r.reasons,'__operation_identity:'))
    )
  )
  select jsonb_build_object(
    'reviewCount',(select count(*) from public.bank_review_items),
    'reviewAmount',(select coalesce(sum(amount),0) from public.bank_review_items),
    'transactionCount',(select count(*) from public.finance_bank_transactions),
    'transactionAmount',(select coalesce(sum(amount),0) from public.finance_bank_transactions),
    'sourceCountDifference',(select count(*) from uncovered),
    'sourceAmountDifference',(select coalesce(sum(amount),0) from uncovered),
    'unprojectedCount',(select count(*) from uncovered),
    -- Только зарегистрированные выписки (registered_at not null) — карточка,
    -- созданная только построчным триггером, не несёт настоящей шапки файла
    -- и по построению не может дать ничего, кроме вечного шума.
    'statementMismatchCount',(select count(*) from public.finance_bank_statements s where s.registered_at is not null and (
      s.operation_count<>(select count(*) from public.finance_bank_statement_rows sr where sr.statement_id=s.id)
      or s.declared_debit<>(select coalesce(sum(greatest(-t.amount,0)),0) from public.finance_bank_statement_rows sr join public.finance_bank_transactions t on t.id=sr.transaction_id where sr.statement_id=s.id)
      or s.declared_credit<>(select coalesce(sum(greatest(t.amount,0)),0) from public.finance_bank_statement_rows sr join public.finance_bank_transactions t on t.id=sr.transaction_id where sr.statement_id=s.id))),
    'approvedCount',(select count(*) from public.bank_review_items where status='approved'),
    'allocationCount',(select count(*) from public.finance_bank_allocations),
    'missingApprovedCount',(select count(*) from public.finance_bank_transaction_reconciliation where reconciliation_status='missing'),
    'mismatchCount',(select count(*) from public.finance_bank_transaction_reconciliation where reconciliation_status='mismatch'),
    'mismatchAmount',(select coalesce(sum(difference),0) from public.finance_bank_transaction_reconciliation where reconciliation_status='mismatch'),
    'partialCount',(select count(*) from public.finance_bank_transaction_reconciliation where reconciliation_status='partial')
  )
$$;
revoke all on function public.finance_bank_ledger_control() from public;
grant execute on function public.finance_bank_ledger_control() to service_role;

notify pgrst,'reload schema';
