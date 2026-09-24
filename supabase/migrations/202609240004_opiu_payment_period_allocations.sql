-- ДДС хранит движение денег по дате банка. ОПиУ может признавать один расход
-- в нескольких месяцах (подписка, страховка, аренда). Эти даты нельзя менять
-- в payments: распределение начисления живёт отдельными строками.

create table if not exists public.opiu_payment_period_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  period_month date not null,
  amount numeric(18,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint opiu_payment_period_month_start_ck
    check (period_month = date_trunc('month', period_month)::date),
  constraint opiu_payment_period_once_uq unique (payment_id, period_month)
);

create index if not exists opiu_payment_period_month_idx
  on public.opiu_payment_period_allocations(period_month, payment_id);

alter table public.opiu_payment_period_allocations enable row level security;
revoke all on public.opiu_payment_period_allocations from anon, authenticated;
grant all on public.opiu_payment_period_allocations to service_role;

create or replace function public.validate_opiu_payment_period_total()
returns trigger
language plpgsql
set search_path = public
as $validate_opiu_payment_period_total$
declare
  v_payment_id uuid := case when tg_op = 'DELETE' then old.payment_id else new.payment_id end;
  v_payment public.payments%rowtype;
  v_total numeric(18,2);
begin
  if not exists (
    select 1 from public.opiu_payment_period_allocations
    where payment_id = v_payment_id
  ) then
    return null;
  end if;

  select * into v_payment from public.payments where id = v_payment_id;
  if v_payment.id is null
    or v_payment.status <> 'done'
    or v_payment.amount >= 0
    or coalesce(v_payment.import_source, '') !~ '^(bank-review|dds-chain|manual-dds|dds-file):'
  then
    raise exception 'Распределять по месяцам можно только фактический расход ДДС' using errcode = '23514';
  end if;

  select round(sum(amount), 2) into v_total
  from public.opiu_payment_period_allocations
  where payment_id = v_payment_id;
  if v_total <> round(abs(v_payment.amount), 2) then
    raise exception 'Сумма распределения ОПиУ должна равняться сумме платежа' using errcode = '23514';
  end if;
  return null;
end;
$validate_opiu_payment_period_total$;

drop trigger if exists opiu_payment_period_total_guard on public.opiu_payment_period_allocations;
create constraint trigger opiu_payment_period_total_guard
after insert or update or delete on public.opiu_payment_period_allocations
deferrable initially deferred
for each row execute function public.validate_opiu_payment_period_total();

create or replace function public.protect_allocated_opiu_payment()
returns trigger
language plpgsql
set search_path = public
as $protect_allocated_opiu_payment$
declare v_total numeric(18,2);
begin
  if not exists (
    select 1 from public.opiu_payment_period_allocations where payment_id = old.id
  ) then return new; end if;
  select round(sum(amount), 2) into v_total
  from public.opiu_payment_period_allocations where payment_id = old.id;
  if new.status <> 'done'
    or new.amount >= 0
    or coalesce(new.import_source, '') !~ '^(bank-review|dds-chain|manual-dds|dds-file):'
    or v_total <> round(abs(new.amount), 2)
  then
    raise exception 'Сначала измените или отмените распределение платежа по месяцам ОПиУ' using errcode = '23514';
  end if;
  return new;
end;
$protect_allocated_opiu_payment$;

drop trigger if exists protect_allocated_opiu_payment on public.payments;
create trigger protect_allocated_opiu_payment
before update of amount, status, import_source on public.payments
for each row execute function public.protect_allocated_opiu_payment();

create or replace function public.save_opiu_payment_period_allocations(
  p_payment_id uuid,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $save_opiu_payment_period_allocations$
declare
  v_payment public.payments%rowtype;
  v_count integer;
  v_total numeric(18,2);
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'Распределение должно быть массивом' using errcode = '22023';
  end if;
  select * into v_payment from public.payments where id = p_payment_id for update;
  if v_payment.id is null then raise exception 'Платёж не найден' using errcode = 'P0002'; end if;
  if v_payment.status <> 'done'
    or v_payment.amount >= 0
    or coalesce(v_payment.import_source, '') !~ '^(bank-review|dds-chain|manual-dds|dds-file):'
  then
    raise exception 'Распределять по месяцам можно только фактический расход ДДС' using errcode = '23514';
  end if;

  v_count := jsonb_array_length(coalesce(p_rows, '[]'::jsonb));
  if v_count > 120 then raise exception 'Не больше 120 месяцев на один платёж' using errcode = '22023'; end if;
  if v_count = 0 then
    delete from public.opiu_payment_period_allocations where payment_id = p_payment_id;
    return jsonb_build_object('saved', 0, 'total', 0);
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) item
    where coalesce(item->>'month', '') !~ '^\d{4}-(0[1-9]|1[0-2])$'
      or coalesce(item->>'amount', '') !~ '^\d+(\.\d{1,2})?$'
      or case
        when coalesce(item->>'amount', '') ~ '^\d+(\.\d{1,2})?$' then (item->>'amount')::numeric <= 0
        else false
      end
  ) then
    raise exception 'Проверьте месяц и положительную сумму каждой строки' using errcode = '22023';
  end if;
  if exists (
    select item->>'month' from jsonb_array_elements(p_rows) item
    group by item->>'month' having count(*) > 1
  ) then
    raise exception 'Один месяц нельзя указать дважды' using errcode = '23505';
  end if;
  select round(sum((item->>'amount')::numeric), 2) into v_total
  from jsonb_array_elements(p_rows) item;
  if v_total <> round(abs(v_payment.amount), 2) then
    raise exception 'Сумма распределения ОПиУ должна равняться сумме платежа' using errcode = '23514';
  end if;

  delete from public.opiu_payment_period_allocations where payment_id = p_payment_id;
  insert into public.opiu_payment_period_allocations(payment_id, period_month, amount)
  select p_payment_id, ((item->>'month') || '-01')::date, round((item->>'amount')::numeric, 2)
  from jsonb_array_elements(p_rows) item;
  return jsonb_build_object('saved', v_count, 'total', v_total);
end;
$save_opiu_payment_period_allocations$;

revoke all on function public.save_opiu_payment_period_allocations(uuid, jsonb) from public;
grant execute on function public.save_opiu_payment_period_allocations(uuid, jsonb) to service_role;

create or replace function public.opiu_dds_facts_for_month(p_from date, p_to date)
returns table (
  id text,
  date date,
  payment_date date,
  name text,
  counterparty text,
  amount numeric,
  category text,
  comment text,
  company_id text,
  status text,
  import_source text,
  opiu_allocation_id uuid
)
language sql
stable
security definer
set search_path = public
as $opiu_dds_facts_for_month$
  select
    p.id::text, p.date, p.date, p.name, p.counterparty, p.amount, p.category,
    p.comment, p.company_id::text, p.status, p.import_source, null::uuid
  from public.payments p
  where p.status = 'done'
    and coalesce(p.import_source, '') ~ '^(bank-review|dds-chain|manual-dds|dds-file):'
    and p.date between p_from and p_to
    and not exists (
      select 1 from public.opiu_payment_period_allocations a where a.payment_id = p.id
    )
  union all
  select
    p.id::text, a.period_month, p.date, p.name, p.counterparty, -a.amount, p.category,
    p.comment, p.company_id::text, p.status, p.import_source, a.id
  from public.opiu_payment_period_allocations a
  join public.payments p on p.id = a.payment_id
  where a.period_month between p_from and p_to
    and p.status = 'done'
    and p.amount < 0
    and coalesce(p.import_source, '') ~ '^(bank-review|dds-chain|manual-dds|dds-file):';
$opiu_dds_facts_for_month$;

revoke all on function public.opiu_dds_facts_for_month(date, date) from public;
grant execute on function public.opiu_dds_facts_for_month(date, date) to service_role;

comment on table public.opiu_payment_period_allocations is
  'Периоды признания расхода в ОПиУ. Дата и сумма исходного движения ДДС остаются в payments.';

notify pgrst, 'reload schema';
