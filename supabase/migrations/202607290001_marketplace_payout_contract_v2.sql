-- Marketplace payout DB/RPC contract v2.
-- Additive candidate only: the owner applies this file to a disposable branch first.

do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'payout_rpc_owner') then
    create role payout_rpc_owner nologin nosuperuser nocreatedb nocreaterole noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'payout_rpc_executor') then
    create role payout_rpc_executor nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end
$roles$;
alter role payout_rpc_owner with nologin nosuperuser nocreatedb nocreaterole noinherit bypassrls;
alter role payout_rpc_executor with nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;

grant usage on schema public to payout_rpc_owner;
grant select, insert, update on table
  public.app_users, public.wb_cabinets, public.companies, public.accounts,
  public.payments
to payout_rpc_owner;

create table if not exists public.marketplace_payout_routes (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  marketplace text not null check (marketplace in ('ozon', 'wb')),
  cabinet_id uuid not null references public.wb_cabinets(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  receiving_account_id uuid not null references public.accounts(id) on delete restrict,
  payer_inn text not null check (payer_inn ~ '^[0-9]{10}([0-9]{2})?$'),
  payer_kpp text check (payer_kpp is null or payer_kpp ~ '^[0-9]{9}$'),
  payer_legal_name text not null check (pg_catalog.btrim(payer_legal_name) <> ''),
  account_kind text not null check (account_kind in ('dedicated_marketplace', 'shared')),
  require_exact_payer_inn boolean not null,
  is_active boolean not null default true,
  valid_from timestamptz not null default pg_catalog.clock_timestamp(),
  retired_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_by uuid not null references public.app_users(id) on delete restrict,
  check (account_kind <> 'shared' or require_exact_payer_inn),
  check (is_active = (retired_at is null)),
  check (retired_at is null or retired_at > valid_from),
  unique (id, marketplace, cabinet_id, company_id, receiving_account_id)
);
create unique index if not exists marketplace_payout_routes_one_active_per_cabinet_uq
  on public.marketplace_payout_routes(marketplace, cabinet_id) where is_active;
create index if not exists marketplace_payout_routes_receipt_match_idx
  on public.marketplace_payout_routes(receiving_account_id, payer_inn, marketplace)
  where is_active;

create table if not exists public.marketplace_payout_series (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  marketplace text not null check (marketplace in ('ozon', 'wb')),
  cabinet_id uuid not null references public.wb_cabinets(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  series_key text not null check (pg_catalog.btrim(series_key) <> ''),
  latest_revision bigint not null default 0 check (latest_revision >= 0),
  current_published_revision bigint not null default 0
    check (current_published_revision >= 0 and current_published_revision <= latest_revision),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (marketplace, cabinet_id, company_id, series_key),
  unique (id, marketplace, cabinet_id, company_id)
);

create table if not exists public.marketplace_payout_forecast_revisions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  series_id uuid not null,
  marketplace text not null,
  cabinet_id uuid not null,
  company_id uuid not null,
  route_id uuid not null,
  receiving_account_id uuid not null,
  revision bigint not null check (revision > 0),
  publication_state text not null check (publication_state in
    ('previewed', 'approved', 'published', 'superseded', 'discarded')),
  payload_hash bytea not null check (pg_catalog.octet_length(payload_hash) = 32),
  source_observed_at timestamptz not null,
  source_data_status text not null check (source_data_status = 'available'),
  unallocated_amount numeric(18,2) not null default 0 check (unallocated_amount >= 0),
  unresolved_receipt_count integer not null default 0 check (unresolved_receipt_count >= 0),
  approved_at timestamptz,
  approved_by uuid references public.app_users(id) on delete restrict,
  published_at timestamptz,
  published_by uuid references public.app_users(id) on delete restrict,
  superseded_at timestamptz,
  superseded_by_version_id uuid references public.marketplace_payout_forecast_revisions(id) on delete restrict,
  discarded_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key (series_id, marketplace, cabinet_id, company_id)
    references public.marketplace_payout_series(id, marketplace, cabinet_id, company_id)
    on delete restrict,
  foreign key (route_id, marketplace, cabinet_id, company_id, receiving_account_id)
    references public.marketplace_payout_routes(id, marketplace, cabinet_id, company_id, receiving_account_id)
    on delete restrict,
  unique (series_id, revision),
  check ((approved_at is not null and approved_by is not null) =
    (publication_state in ('approved', 'published', 'superseded'))),
  check ((published_at is not null and published_by is not null) =
    (publication_state in ('published', 'superseded'))),
  check ((superseded_at is not null and superseded_by_version_id is not null) =
    (publication_state = 'superseded')),
  check ((discarded_at is not null) = (publication_state = 'discarded')),
  check (superseded_by_version_id is null or superseded_by_version_id <> id)
);
create unique index if not exists marketplace_payout_versions_one_open_draft_uq
  on public.marketplace_payout_forecast_revisions(series_id)
  where publication_state in ('previewed', 'approved');
create unique index if not exists marketplace_payout_versions_one_published_uq
  on public.marketplace_payout_forecast_revisions(series_id)
  where publication_state = 'published';
create index if not exists marketplace_payout_versions_history_idx
  on public.marketplace_payout_forecast_revisions(series_id, revision desc);

create table if not exists public.marketplace_payout_forecast_lines (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  version_id uuid not null references public.marketplace_payout_forecast_revisions(id) on delete restrict,
  line_key text not null check (pg_catalog.btrim(line_key) <> ''),
  source_kind text not null check (source_kind in ('forecast', 'provider_report')),
  provider_report_id text,
  provider_schedule_id text,
  period_from date,
  period_to date,
  expected_receipt_date date not null,
  amount numeric(18,2) not null check (amount > 0),
  currency text not null default 'RUB' check (currency ~ '^[A-Z]{3}$'),
  lifecycle_state text not null check (lifecycle_state in
    ('forecast', 'report_confirmed', 'marketplace_scheduled',
     'partially_received', 'bank_received')),
  payment_id uuid references public.payments(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (version_id, line_key),
  check ((period_from is null) = (period_to is null)),
  check (period_to is null or period_to >= period_from),
  check ((source_kind = 'forecast' and provider_report_id is null) or
    (source_kind = 'provider_report' and provider_report_id is not null
      and pg_catalog.btrim(provider_report_id) <> '')),
  check (lifecycle_state <> 'report_confirmed' or source_kind = 'provider_report'),
  check (payment_id is null or lifecycle_state in
    ('marketplace_scheduled', 'partially_received', 'bank_received'))
);
create unique index if not exists marketplace_payout_lines_report_per_version_uq
  on public.marketplace_payout_forecast_lines(version_id, provider_report_id)
  where provider_report_id is not null;
create unique index if not exists marketplace_payout_lines_payment_uq
  on public.marketplace_payout_forecast_lines(payment_id) where payment_id is not null;
create index if not exists marketplace_payout_lines_version_idx
  on public.marketplace_payout_forecast_lines(version_id, id);

create table if not exists public.marketplace_payout_receipt_reconciliations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  receipt_payment_id uuid not null references public.payments(id) on delete restrict,
  state text not null check (state in ('active', 'reversed')),
  receipt_amount_snapshot numeric(18,2) not null check (receipt_amount_snapshot > 0),
  payer_inn text check (payer_inn is null or payer_inn ~ '^[0-9]{10}([0-9]{2})?$'),
  payer_kpp text check (payer_kpp is null or payer_kpp ~ '^[0-9]{9}$'),
  payer_legal_name text,
  payer_account_number text,
  identity_source text not null check (identity_source in
    ('bank_import_structured', 'manual_verified', 'legacy_text')),
  identity_verified boolean not null,
  unresolved_amount numeric(18,2) not null default 0
    check (unresolved_amount >= 0 and unresolved_amount <= receipt_amount_snapshot),
  unresolved_reason text check (unresolved_reason is null or unresolved_reason in
    ('unlinked', 'ambiguous', 'partial', 'payer_unverified',
     'company_mismatch', 'account_mismatch')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_by uuid not null references public.app_users(id) on delete restrict,
  reversed_at timestamptz,
  reversed_by uuid references public.app_users(id) on delete restrict,
  reversal_reason text,
  check ((unresolved_amount = 0 and unresolved_reason is null) or
    (unresolved_amount > 0 and unresolved_reason is not null)),
  check ((reversed_at is not null and reversed_by is not null
    and pg_catalog.btrim(reversal_reason) <> '') = (state = 'reversed')),
  check (identity_source <> 'legacy_text' or identity_verified = false)
);
create unique index if not exists marketplace_payout_receipts_one_active_uq
  on public.marketplace_payout_receipt_reconciliations(receipt_payment_id)
  where state = 'active';

create table if not exists public.marketplace_payout_receipt_allocations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  reconciliation_id uuid not null
    references public.marketplace_payout_receipt_reconciliations(id) on delete restrict,
  forecast_line_id uuid not null
    references public.marketplace_payout_forecast_lines(id) on delete restrict,
  allocated_amount numeric(18,2) not null check (allocated_amount > 0),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (reconciliation_id, forecast_line_id)
);
create index if not exists marketplace_payout_allocations_line_idx
  on public.marketplace_payout_receipt_allocations(forecast_line_id);
create index if not exists marketplace_payout_allocations_reconciliation_idx
  on public.marketplace_payout_receipt_allocations(reconciliation_id);

create table if not exists public.marketplace_payout_audit (
  id bigint generated always as identity primary key,
  operation_id uuid not null unique default pg_catalog.gen_random_uuid(),
  request_id uuid not null,
  actor_id uuid not null references public.app_users(id) on delete restrict,
  operation text not null check (operation in
    ('preview', 'approve', 'publish', 'replace', 'reconcile')),
  request_hash bytea not null check (pg_catalog.octet_length(request_hash) = 32),
  request_json jsonb not null check (pg_catalog.jsonb_typeof(request_json) = 'object'),
  result_json jsonb not null check (pg_catalog.jsonb_typeof(result_json) = 'object'),
  series_id uuid references public.marketplace_payout_series(id) on delete restrict,
  version_id uuid references public.marketplace_payout_forecast_revisions(id) on delete restrict,
  reconciliation_id uuid references public.marketplace_payout_receipt_reconciliations(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (actor_id, request_id)
);
create index if not exists marketplace_payout_audit_series_idx
  on public.marketplace_payout_audit(series_id, created_at desc);

alter table public.marketplace_payout_routes enable row level security;
alter table public.marketplace_payout_series enable row level security;
alter table public.marketplace_payout_forecast_revisions enable row level security;
alter table public.marketplace_payout_forecast_lines enable row level security;
alter table public.marketplace_payout_receipt_reconciliations enable row level security;
alter table public.marketplace_payout_receipt_allocations enable row level security;
alter table public.marketplace_payout_audit enable row level security;

revoke all on table public.marketplace_payout_routes,
  public.marketplace_payout_series,
  public.marketplace_payout_forecast_revisions,
  public.marketplace_payout_forecast_lines,
  public.marketplace_payout_receipt_reconciliations,
  public.marketplace_payout_receipt_allocations,
  public.marketplace_payout_audit
from public, anon, authenticated, service_role;
grant select, insert, update on table public.marketplace_payout_routes,
  public.marketplace_payout_series,
  public.marketplace_payout_forecast_revisions,
  public.marketplace_payout_forecast_lines,
  public.marketplace_payout_receipt_reconciliations,
  public.marketplace_payout_receipt_allocations,
  public.marketplace_payout_audit
to payout_rpc_owner;
grant usage, select on sequence public.marketplace_payout_audit_id_seq to payout_rpc_owner;

create or replace function public._payout_actor(
  p_actor_id uuid, p_cabinet_id uuid, p_roles text[]
) returns public.app_users
language plpgsql security definer set search_path = ''
as $fn$
declare v_actor public.app_users;
begin
  select * into v_actor from public.app_users where id = p_actor_id;
  if not found or v_actor.is_active is not true then
    raise exception using errcode = 'P0001', message = 'UNAUTHENTICATED';
  end if;
  if not (v_actor.role = any(p_roles)) then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;
  if p_cabinet_id is not null
     and pg_catalog.coalesce(pg_catalog.array_length(v_actor.cabinet_ids, 1), 0) > 0
     and not (p_cabinet_id = any(v_actor.cabinet_ids)) then
    raise exception using errcode = 'P0001', message = 'CABINET_FORBIDDEN';
  end if;
  return v_actor;
end
$fn$;

create or replace function public._payout_assert_keys(
  p_value jsonb, p_required text[], p_optional text[]
) returns void
language plpgsql immutable set search_path = ''
as $fn$
declare v_key text;
begin
  if pg_catalog.jsonb_typeof(p_value) <> 'object'
     or pg_catalog.octet_length(pg_catalog.convert_to(p_value::text, 'UTF8')) > 1048576 then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
  end if;
  foreach v_key in array p_required loop
    if not (p_value ? v_key) then
      raise exception using errcode = 'P0001', message = 'MISSING_KEY:' || v_key;
    end if;
  end loop;
  for v_key in select k from pg_catalog.jsonb_object_keys(p_value) as keys(k) loop
    if not (v_key = any(p_required) or v_key = any(p_optional)) then
      raise exception using errcode = 'P0001', message = 'UNKNOWN_KEY:' || v_key;
    end if;
  end loop;
end
$fn$;

create or replace function public._payout_request_hash(p_value jsonb)
returns bytea language sql immutable set search_path = ''
return extensions.digest(pg_catalog.convert_to(p_value::text, 'UTF8'), 'sha256');

create or replace function public._payout_replay(
  p_actor_id uuid, p_request_id uuid, p_operation text, p_hash bytea
) returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare v_row public.marketplace_payout_audit;
begin
  select * into v_row from public.marketplace_payout_audit
  where actor_id = p_actor_id and request_id = p_request_id;
  if not found then return null; end if;
  if v_row.operation <> p_operation or v_row.request_hash <> p_hash then
    raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
  end if;
  return v_row.result_json;
end
$fn$;

create or replace function public._payout_immutable_guard()
returns trigger language plpgsql set search_path = ''
as $fn$
begin
  if current_user = 'payout_rpc_owner' then return new; end if;
  raise exception using errcode = 'P0001', message = 'IMMUTABLE_PAYOUT_SNAPSHOT';
end
$fn$;

create or replace function public._payout_route_guard()
returns trigger language plpgsql set search_path = ''
as $fn$
begin
  if exists (
    select 1 from public.marketplace_payout_forecast_revisions where route_id = old.id
  ) and (
    new.id is distinct from old.id
    or new.marketplace is distinct from old.marketplace
    or new.cabinet_id is distinct from old.cabinet_id
    or new.company_id is distinct from old.company_id
    or new.receiving_account_id is distinct from old.receiving_account_id
    or new.payer_inn is distinct from old.payer_inn
    or new.payer_kpp is distinct from old.payer_kpp
    or new.payer_legal_name is distinct from old.payer_legal_name
    or new.account_kind is distinct from old.account_kind
    or new.require_exact_payer_inn is distinct from old.require_exact_payer_inn
    or new.valid_from is distinct from old.valid_from
    or new.created_at is distinct from old.created_at
    or new.created_by is distinct from old.created_by
  ) then
    raise exception using errcode = 'P0001', message = 'USED_ROUTE_IMMUTABLE';
  end if;
  return new;
end
$fn$;

create or replace function public._payout_route_validate()
returns trigger language plpgsql set search_path = ''
as $fn$
begin
  if not exists (select 1 from public.wb_cabinets c
    where c.id=new.cabinet_id and c.is_active is true
      and c.marketplace=new.marketplace) then
    raise exception using errcode='P0001',message='INVALID_ROUTE_CABINET';
  end if;
  if not exists (select 1 from public.companies c
    where c.id=new.company_id and c.is_active is true) then
    raise exception using errcode='P0001',message='INVALID_ROUTE_COMPANY';
  end if;
  if not exists (select 1 from public.accounts a
    where a.id=new.receiving_account_id and a.currency='RUB') then
    raise exception using errcode='P0001',message='INVALID_ROUTE_ACCOUNT';
  end if;
  return new;
end
$fn$;

create or replace function public._payout_revision_guard()
returns trigger language plpgsql set search_path = ''
as $fn$
begin
  if new.id is distinct from old.id
    or new.series_id is distinct from old.series_id
    or new.marketplace is distinct from old.marketplace
    or new.cabinet_id is distinct from old.cabinet_id
    or new.company_id is distinct from old.company_id
    or new.route_id is distinct from old.route_id
    or new.receiving_account_id is distinct from old.receiving_account_id
    or new.revision is distinct from old.revision
    or new.payload_hash is distinct from old.payload_hash
    or new.source_observed_at is distinct from old.source_observed_at
    or new.source_data_status is distinct from old.source_data_status
    or new.unallocated_amount is distinct from old.unallocated_amount
    or new.unresolved_receipt_count is distinct from old.unresolved_receipt_count
    or new.created_at is distinct from old.created_at then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE_PAYOUT_SNAPSHOT';
  end if;
  if current_user <> 'payout_rpc_owner' then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE_PAYOUT_SNAPSHOT';
  end if;
  return new;
end
$fn$;

create or replace function public._payout_audit_guard()
returns trigger language plpgsql set search_path = ''
as $fn$
begin
  if current_user = 'payout_rpc_owner'
    and pg_catalog.current_setting('payout.test_cleanup', true) = 'on' then
    return old;
  end if;
  raise exception using errcode = 'P0001', message = 'AUDIT_APPEND_ONLY';
end
$fn$;

do $triggers$
begin
  if not exists (select 1 from pg_catalog.pg_trigger
    where tgname='marketplace_payout_route_immutable' and not tgisinternal) then
    execute 'create trigger marketplace_payout_route_immutable before update
      on public.marketplace_payout_routes for each row
      execute function public._payout_route_guard()';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger
    where tgname='marketplace_payout_route_validate' and not tgisinternal) then
    execute 'create trigger marketplace_payout_route_validate before insert or update
      on public.marketplace_payout_routes for each row
      execute function public._payout_route_validate()';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger
    where tgname='marketplace_payout_revision_immutable' and not tgisinternal) then
    execute 'create trigger marketplace_payout_revision_immutable before update
      on public.marketplace_payout_forecast_revisions for each row
      execute function public._payout_revision_guard()';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger
    where tgname='marketplace_payout_lines_immutable' and not tgisinternal) then
    execute 'create trigger marketplace_payout_lines_immutable before update or delete
      on public.marketplace_payout_forecast_lines for each row
      execute function public._payout_immutable_guard()';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger
    where tgname='marketplace_payout_allocations_immutable' and not tgisinternal) then
    execute 'create trigger marketplace_payout_allocations_immutable before update or delete
      on public.marketplace_payout_receipt_allocations for each row
      execute function public._payout_immutable_guard()';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger
    where tgname='marketplace_payout_audit_immutable' and not tgisinternal) then
    execute 'create trigger marketplace_payout_audit_immutable before update or delete
      on public.marketplace_payout_audit for each row
      execute function public._payout_audit_guard()';
  end if;
end
$triggers$;

create or replace function public.preview_marketplace_payout(p_request jsonb, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare
  v_request_id uuid; v_cabinet uuid; v_route public.marketplace_payout_routes;
  v_series public.marketplace_payout_series; v_version uuid; v_revision bigint;
  v_hash bytea; v_replay jsonb; v_line jsonb; v_lines jsonb; v_result jsonb;
begin
  perform public._payout_assert_keys(p_request,
    array['requestId','marketplace','cabinetId','seriesKey','expectedPublishedRevision',
      'sourceObservedAt','sourceDataStatus','unallocatedAmount','unresolvedReceiptCount','lines'],
    array['companyId','receivingAccountId']);
  v_request_id := (p_request->>'requestId')::uuid;
  v_cabinet := (p_request->>'cabinetId')::uuid;
  perform public._payout_actor(p_actor_id, v_cabinet, array['finance','director']);
  if pg_catalog.jsonb_typeof(p_request->'lines') <> 'array'
     or pg_catalog.jsonb_array_length(p_request->'lines') not between 1 and 500 then
    raise exception using errcode = 'P0001', message = 'INVALID_LINES';
  end if;
  if p_request->>'sourceDataStatus' <> 'available'
     or (p_request->>'unallocatedAmount')::numeric <> 0
     or (p_request->>'unresolvedReceiptCount')::integer <> 0 then
    raise exception using errcode = 'P0001', message = 'SOURCE_BLOCKED';
  end if;
  select * into strict v_route from public.marketplace_payout_routes
   where marketplace = p_request->>'marketplace' and cabinet_id = v_cabinet and is_active
   for update;
  if p_request ? 'companyId' and (p_request->>'companyId')::uuid <> v_route.company_id
     or p_request ? 'receivingAccountId'
       and (p_request->>'receivingAccountId')::uuid <> v_route.receiving_account_id then
    raise exception using errcode = 'P0001', message = 'ROUTE_ASSERTION_MISMATCH';
  end if;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'lineKey', x->>'lineKey', 'sourceKind', x->>'sourceKind',
    'providerReportId', x->>'providerReportId', 'providerScheduleId', x->>'providerScheduleId',
    'periodFrom', x->>'periodFrom', 'periodTo', x->>'periodTo',
    'expectedReceiptDate', x->>'expectedReceiptDate',
    'amount', pg_catalog.to_char((x->>'amount')::numeric, 'FM999999999999990.00'),
    'currency', x->>'currency', 'lifecycleState', x->>'lifecycleState'
  ) order by x->>'lineKey') into v_lines
  from pg_catalog.jsonb_array_elements(p_request->'lines') x;
  if (select pg_catalog.count(*) <> pg_catalog.count(distinct x->>'lineKey')
      from pg_catalog.jsonb_array_elements(p_request->'lines') x) then
    raise exception using errcode = 'P0001', message = 'DUPLICATE_LINE';
  end if;
  for v_line in select value from pg_catalog.jsonb_array_elements(p_request->'lines') loop
    perform public._payout_assert_keys(v_line,
      array['lineKey','sourceKind','expectedReceiptDate','amount','currency','lifecycleState'],
      array['providerReportId','providerScheduleId','periodFrom','periodTo']);
    if pg_catalog.btrim(v_line->>'lineKey') = ''
       or (v_line->>'amount')::numeric <= 0
       or (v_line->>'amount')::numeric > 9999999999999999.99
       or pg_catalog.scale((v_line->>'amount')::numeric) > 2 then
      raise exception using errcode = 'P0001', message = 'INVALID_LINE';
    end if;
  end loop;
  v_hash := public._payout_request_hash(pg_catalog.jsonb_build_object(
    'marketplace', p_request->>'marketplace', 'cabinetId', v_cabinet,
    'seriesKey', p_request->>'seriesKey', 'routeId', v_route.id,
    'sourceObservedAt', ((p_request->>'sourceObservedAt')::timestamptz at time zone 'UTC'),
    'sourceDataStatus', 'available', 'unallocatedAmount', '0.00',
    'unresolvedReceiptCount', 0, 'lines', v_lines));
  v_replay := public._payout_replay(p_actor_id, v_request_id, 'preview', v_hash);
  if v_replay is not null then return v_replay; end if;
  insert into public.marketplace_payout_series(marketplace,cabinet_id,company_id,series_key)
    values(v_route.marketplace,v_route.cabinet_id,v_route.company_id,p_request->>'seriesKey')
    on conflict (marketplace,cabinet_id,company_id,series_key) do nothing;
  select * into v_series from public.marketplace_payout_series
   where marketplace=v_route.marketplace and cabinet_id=v_route.cabinet_id
     and company_id=v_route.company_id and series_key=p_request->>'seriesKey'
   for update;
  if v_series.current_published_revision <> (p_request->>'expectedPublishedRevision')::bigint then
    raise exception using errcode = 'P0001', message = 'CAS_CONFLICT';
  end if;
  select payload_hash, id into v_hash, v_version
    from public.marketplace_payout_forecast_revisions
   where series_id=v_series.id and publication_state in ('previewed','approved');
  if found then
    if v_hash = public._payout_request_hash(pg_catalog.jsonb_build_object(
      'marketplace', p_request->>'marketplace', 'cabinetId', v_cabinet,
      'seriesKey', p_request->>'seriesKey', 'routeId', v_route.id,
      'sourceObservedAt', ((p_request->>'sourceObservedAt')::timestamptz at time zone 'UTC'),
      'sourceDataStatus', 'available', 'unallocatedAmount', '0.00',
      'unresolvedReceiptCount', 0, 'lines', v_lines)) then
      select revision into v_revision from public.marketplace_payout_forecast_revisions where id=v_version;
      v_result := pg_catalog.jsonb_build_object('ok',true,'versionId',v_version,'revision',v_revision,
        'publicationState','previewed','payloadHash',pg_catalog.encode(v_hash,'hex'),'logicalReplay',true);
      insert into public.marketplace_payout_audit(
        request_id,actor_id,operation,request_hash,request_json,result_json,series_id,version_id)
      values(v_request_id,p_actor_id,'preview',v_hash,p_request,v_result,v_series.id,v_version);
      return v_result;
    end if;
    raise exception using errcode = 'P0001', message = 'OPEN_DRAFT_EXISTS';
  end if;
  v_revision := v_series.latest_revision + 1;
  update public.marketplace_payout_series set latest_revision=v_revision where id=v_series.id;
  v_hash := public._payout_request_hash(pg_catalog.jsonb_build_object(
    'marketplace', p_request->>'marketplace', 'cabinetId', v_cabinet,
    'seriesKey', p_request->>'seriesKey', 'routeId', v_route.id,
    'sourceObservedAt', ((p_request->>'sourceObservedAt')::timestamptz at time zone 'UTC'),
    'sourceDataStatus', 'available', 'unallocatedAmount', '0.00',
    'unresolvedReceiptCount', 0, 'lines', v_lines));
  insert into public.marketplace_payout_forecast_revisions(
    series_id,marketplace,cabinet_id,company_id,route_id,receiving_account_id,
    revision,publication_state,payload_hash,source_observed_at,source_data_status)
  values(v_series.id,v_route.marketplace,v_route.cabinet_id,v_route.company_id,v_route.id,
    v_route.receiving_account_id,v_revision,'previewed',v_hash,
    (p_request->>'sourceObservedAt')::timestamptz,'available') returning id into v_version;
  for v_line in select value from pg_catalog.jsonb_array_elements(p_request->'lines') loop
    insert into public.marketplace_payout_forecast_lines(
      version_id,line_key,source_kind,provider_report_id,provider_schedule_id,
      period_from,period_to,expected_receipt_date,amount,currency,lifecycle_state)
    values(v_version,v_line->>'lineKey',v_line->>'sourceKind',
      nullif(v_line->>'providerReportId',''),nullif(v_line->>'providerScheduleId',''),
      nullif(v_line->>'periodFrom','')::date,nullif(v_line->>'periodTo','')::date,
      (v_line->>'expectedReceiptDate')::date,(v_line->>'amount')::numeric,
      v_line->>'currency',v_line->>'lifecycleState');
  end loop;
  v_result := pg_catalog.jsonb_build_object('ok',true,'versionId',v_version,
    'revision',v_revision,'publicationState','previewed',
    'payloadHash',pg_catalog.encode(v_hash,'hex'),'canApprove',true);
  insert into public.marketplace_payout_audit(
    request_id,actor_id,operation,request_hash,request_json,result_json,series_id,version_id)
  values(v_request_id,p_actor_id,'preview',v_hash,p_request,v_result,v_series.id,v_version);
  return v_result;
exception when no_data_found then
  raise exception using errcode = 'P0001', message = 'ACTIVE_ROUTE_NOT_FOUND';
end
$fn$;

create or replace function public.approve_marketplace_payout(p_request jsonb, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare v_request_id uuid; v_version public.marketplace_payout_forecast_revisions;
  v_series public.marketplace_payout_series; v_hash bytea; v_replay jsonb; v_result jsonb;
begin
  perform public._payout_assert_keys(p_request,
    array['requestId','versionId','expectedPayloadHash'],array[]::text[]);
  v_request_id := (p_request->>'requestId')::uuid;
  select s.* into strict v_series from public.marketplace_payout_series s
  join public.marketplace_payout_forecast_revisions v on v.series_id=s.id
  where v.id=(p_request->>'versionId')::uuid for update of s;
  perform public._payout_actor(p_actor_id,v_series.cabinet_id,array['director']);
  v_hash := public._payout_request_hash(p_request - array['requestId','expectedPayloadHash']);
  v_replay := public._payout_replay(p_actor_id,v_request_id,'approve',v_hash);
  if v_replay is not null then return v_replay; end if;
  select * into strict v_version from public.marketplace_payout_forecast_revisions
   where id=(p_request->>'versionId')::uuid for update;
  perform 1 from public.marketplace_payout_forecast_lines where version_id=v_version.id
    order by id for update;
  if v_version.publication_state <> 'previewed' then
    raise exception using errcode='P0001',message='INVALID_STATE';
  end if;
  if pg_catalog.encode(v_version.payload_hash,'hex') <> pg_catalog.lower(p_request->>'expectedPayloadHash') then
    raise exception using errcode='P0001',message='HASH_MISMATCH';
  end if;
  if not exists(select 1 from public.marketplace_payout_routes
    where id=v_version.route_id and is_active) or v_version.unallocated_amount<>0
    or v_version.unresolved_receipt_count<>0 then
    raise exception using errcode='P0001',message='APPROVAL_BLOCKED';
  end if;
  update public.marketplace_payout_forecast_revisions set publication_state='approved',
    approved_at=pg_catalog.clock_timestamp(),approved_by=p_actor_id where id=v_version.id;
  v_result:=pg_catalog.jsonb_build_object('ok',true,'versionId',v_version.id,
    'publicationState','approved','payloadHash',pg_catalog.encode(v_version.payload_hash,'hex'));
  insert into public.marketplace_payout_audit(request_id,actor_id,operation,request_hash,
    request_json,result_json,series_id,version_id)
  values(v_request_id,p_actor_id,'approve',v_hash,p_request,v_result,v_series.id,v_version.id);
  return v_result;
exception when no_data_found then
  raise exception using errcode='P0001',message='VERSION_NOT_FOUND';
end
$fn$;

create or replace function public.publish_marketplace_payout(p_request jsonb, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare v_request_id uuid; v_new public.marketplace_payout_forecast_revisions;
  v_old public.marketplace_payout_forecast_revisions; v_series public.marketplace_payout_series;
  v_line record; v_hash bytea; v_replay jsonb; v_result jsonb; v_operation text;
begin
  perform public._payout_assert_keys(p_request,
    array['requestId','versionId','expectedPayloadHash','expectedPublishedRevision'],
    array[]::text[]);
  v_request_id:=(p_request->>'requestId')::uuid;
  select s.* into strict v_series from public.marketplace_payout_series s
  join public.marketplace_payout_forecast_revisions v on v.series_id=s.id
  where v.id=(p_request->>'versionId')::uuid for update of s;
  perform public._payout_actor(p_actor_id,v_series.cabinet_id,array['director']);
  select operation into v_operation from public.marketplace_payout_audit
    where actor_id=p_actor_id and request_id=v_request_id;
  v_operation:=pg_catalog.coalesce(v_operation,
    case when v_series.current_published_revision=0 then 'publish' else 'replace' end);
  v_hash:=public._payout_request_hash(
    p_request-array['requestId','expectedPayloadHash','expectedPublishedRevision']);
  v_replay:=public._payout_replay(p_actor_id,v_request_id,v_operation,v_hash);
  if v_replay is not null then return v_replay; end if;
  if v_series.current_published_revision<>(p_request->>'expectedPublishedRevision')::bigint then
    raise exception using errcode='P0001',message='CAS_CONFLICT';
  end if;
  select * into strict v_new from public.marketplace_payout_forecast_revisions
    where id=(p_request->>'versionId')::uuid for update;
  if v_series.current_published_revision>0 then
    select * into strict v_old from public.marketplace_payout_forecast_revisions
     where series_id=v_series.id and revision=v_series.current_published_revision for update;
  end if;
  perform 1 from public.marketplace_payout_forecast_lines
   where version_id in (v_new.id,v_old.id) order by id for update;
  perform 1 from public.payments where id in (
    select payment_id from public.marketplace_payout_forecast_lines
     where version_id=v_old.id and payment_id is not null) order by id for update;
  perform 1 from public.marketplace_payout_receipt_reconciliations r
   join public.marketplace_payout_receipt_allocations a on a.reconciliation_id=r.id
   join public.marketplace_payout_forecast_lines l on l.id=a.forecast_line_id
   where l.version_id=v_old.id order by r.id for update of r;
  if v_new.publication_state<>'approved'
    or pg_catalog.encode(v_new.payload_hash,'hex')<>pg_catalog.lower(p_request->>'expectedPayloadHash')
    or not exists(select 1 from public.marketplace_payout_routes
      where id=v_new.route_id and is_active)
    or v_new.unallocated_amount<>0 or v_new.unresolved_receipt_count<>0 then
    raise exception using errcode='P0001',message='PUBLISH_BLOCKED';
  end if;
  if exists(select 1 from public.marketplace_payout_forecast_lines nl
    join public.marketplace_payout_forecast_revisions ov
      on ov.publication_state='published' and ov.id<>v_new.id
    join public.marketplace_payout_forecast_lines ol on ol.version_id=ov.id
     and ol.provider_report_id=nl.provider_report_id
    where nl.version_id=v_new.id and nl.provider_report_id is not null
      and ov.series_id<>v_new.series_id
      and ov.marketplace=v_new.marketplace and ov.cabinet_id=v_new.cabinet_id
      and ov.company_id=v_new.company_id) then
    raise exception using errcode='P0001',message='PROVIDER_REPORT_CONFLICT';
  end if;
  if v_old.id is not null and (exists(select 1 from public.marketplace_payout_forecast_lines l
      join public.payments p on p.id=l.payment_id
      where l.version_id=v_old.id and p.status<>'planned')
    or exists(select 1 from public.marketplace_payout_forecast_lines l
      join public.marketplace_payout_receipt_allocations a on a.forecast_line_id=l.id
      where l.version_id=v_old.id)) then
    raise exception using errcode='P0001',message='REPLACE_BLOCKED';
  end if;
  for v_line in select * from public.marketplace_payout_forecast_lines
    where version_id=v_new.id order by id
  loop
    insert into public.payments(id,name,amount,type,category,account_id,date,status,
      counterparty,comment,company_id)
    values(pg_catalog.gen_random_uuid(),'Marketplace payout',v_line.amount,'income',
      'Marketplace payout',v_new.receiving_account_id,v_line.expected_receipt_date,
      'planned','Marketplace','[marketplace-payout-v2]',v_new.company_id)
    returning id into v_line.payment_id;
    update public.marketplace_payout_forecast_lines
      set payment_id=v_line.payment_id,lifecycle_state='marketplace_scheduled'
      where id=v_line.id;
  end loop;
  if v_old.id is not null then
    update public.payments set status='cancelled' where id in (
      select payment_id from public.marketplace_payout_forecast_lines
       where version_id=v_old.id);
    update public.marketplace_payout_forecast_revisions set publication_state='superseded',
      superseded_at=pg_catalog.clock_timestamp(),superseded_by_version_id=v_new.id
      where id=v_old.id;
  end if;
  update public.marketplace_payout_forecast_revisions set publication_state='published',
    published_at=pg_catalog.clock_timestamp(),published_by=p_actor_id where id=v_new.id;
  update public.marketplace_payout_series
    set current_published_revision=v_new.revision where id=v_series.id;
  v_result:=pg_catalog.jsonb_build_object('ok',true,'versionId',v_new.id,
    'revision',v_new.revision,'publicationState','published','operation',v_operation);
  insert into public.marketplace_payout_audit(request_id,actor_id,operation,request_hash,
    request_json,result_json,series_id,version_id)
  values(v_request_id,p_actor_id,v_operation,v_hash,p_request,v_result,v_series.id,v_new.id);
  return v_result;
exception when no_data_found then
  raise exception using errcode='P0001',message='VERSION_NOT_FOUND';
end
$fn$;

create or replace function public.reconcile_marketplace_payout(p_request jsonb, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare v_request_id uuid; v_receipt public.payments; v_old uuid; v_recon uuid;
  v_alloc jsonb; v_identity jsonb; v_hash bytea; v_replay jsonb; v_result jsonb;
  v_route public.marketplace_payout_routes; v_line record; v_sum numeric(18,2);
begin
  perform public._payout_assert_keys(p_request,
    array['requestId','receiptPaymentId','expectedReceiptAmount','expectedAccountId',
      'identity','unresolvedAmount','unresolvedReason','allocations'],
    array['correctionReason']);
  v_request_id:=(p_request->>'requestId')::uuid;
  v_identity:=p_request->'identity';
  perform public._payout_assert_keys(v_identity,
    array['source','verified'],array['payerInn','payerKpp','payerLegalName','payerAccountNumber']);
  if pg_catalog.jsonb_typeof(p_request->'allocations')<>'array'
    or pg_catalog.jsonb_array_length(p_request->'allocations')>500 then
    raise exception using errcode='P0001',message='INVALID_ALLOCATIONS';
  end if;
  select * into strict v_receipt from public.payments
   where id=(p_request->>'receiptPaymentId')::uuid;
  perform public._payout_actor(p_actor_id,null,array['finance','director']);
  perform public._payout_actor(p_actor_id,c.cabinet_id,array['finance','director'])
    from (select distinct r.cabinet_id
      from pg_catalog.jsonb_array_elements(p_request->'allocations') x
      join public.marketplace_payout_forecast_lines l
        on l.id=(x->>'forecastLineId')::uuid
      join public.marketplace_payout_forecast_revisions r on r.id=l.version_id) c;
  v_hash:=public._payout_request_hash(
    p_request-array['requestId','expectedReceiptAmount','expectedAccountId']);
  v_replay:=public._payout_replay(p_actor_id,v_request_id,'reconcile',v_hash);
  if v_replay is not null then return v_replay; end if;
  if (select pg_catalog.count(*)<>pg_catalog.count(distinct x->>'forecastLineId')
      from pg_catalog.jsonb_array_elements(p_request->'allocations') x) then
    raise exception using errcode='P0001',message='DUPLICATE_ALLOCATION';
  end if;
  perform 1 from public.marketplace_payout_series s where s.id in (
    select r.series_id from pg_catalog.jsonb_array_elements(p_request->'allocations') x
    join public.marketplace_payout_forecast_lines l on l.id=(x->>'forecastLineId')::uuid
    join public.marketplace_payout_forecast_revisions r on r.id=l.version_id)
    order by s.id for update;
  perform 1 from public.marketplace_payout_forecast_revisions r where r.id in (
    select l.version_id from pg_catalog.jsonb_array_elements(p_request->'allocations') x
    join public.marketplace_payout_forecast_lines l on l.id=(x->>'forecastLineId')::uuid)
    order by r.id for update;
  perform 1 from public.marketplace_payout_forecast_lines l where l.id in (
    select (x->>'forecastLineId')::uuid
    from pg_catalog.jsonb_array_elements(p_request->'allocations') x)
    order by l.id for update;
  perform 1 from public.payments p where p.id=(p_request->>'receiptPaymentId')::uuid
    or p.id in (
      select l.payment_id from pg_catalog.jsonb_array_elements(p_request->'allocations') x
      join public.marketplace_payout_forecast_lines l on l.id=(x->>'forecastLineId')::uuid)
    order by p.id for update;
  select * into strict v_receipt from public.payments
   where id=(p_request->>'receiptPaymentId')::uuid;
  if v_receipt.status<>'done' or v_receipt.type<>'income' or v_receipt.amount<=0
    or v_receipt.amount<>(p_request->>'expectedReceiptAmount')::numeric
    or v_receipt.account_id<>(p_request->>'expectedAccountId')::uuid then
    raise exception using errcode='P0001',message='RECEIPT_DRIFT';
  end if;
  select id into v_old from public.marketplace_payout_receipt_reconciliations
    where receipt_payment_id=v_receipt.id and state='active' for update;
  if found then
    if pg_catalog.btrim(pg_catalog.coalesce(p_request->>'correctionReason',''))='' then
      raise exception using errcode='P0001',message='CORRECTION_REASON_REQUIRED';
    end if;
    update public.marketplace_payout_receipt_reconciliations set state='reversed',
      reversed_at=pg_catalog.clock_timestamp(),reversed_by=p_actor_id,
      reversal_reason=p_request->>'correctionReason' where id=v_old;
  end if;
  v_sum:=(select pg_catalog.coalesce(pg_catalog.sum((x->>'allocatedAmount')::numeric),0)
    from pg_catalog.jsonb_array_elements(p_request->'allocations') x);
  if v_sum+(p_request->>'unresolvedAmount')::numeric<>v_receipt.amount then
    raise exception using errcode='P0001',message='RECEIPT_SUM_MISMATCH';
  end if;
  for v_alloc in select value from pg_catalog.jsonb_array_elements(p_request->'allocations') loop
    perform public._payout_assert_keys(v_alloc,array['forecastLineId','allocatedAmount'],array[]::text[]);
    if (v_alloc->>'allocatedAmount')::numeric<=0
      or pg_catalog.scale((v_alloc->>'allocatedAmount')::numeric)>2 then
      raise exception using errcode='P0001',message='INVALID_ALLOCATION';
    end if;
    select l.*,r.route_id,r.publication_state into strict v_line
      from public.marketplace_payout_forecast_lines l
      join public.marketplace_payout_forecast_revisions r on r.id=l.version_id
      where l.id=(v_alloc->>'forecastLineId')::uuid;
    if v_line.publication_state<>'published' then
      raise exception using errcode='P0001',message='NOT_CURRENT_PUBLISHED';
    end if;
    select * into strict v_route from public.marketplace_payout_routes where id=v_line.route_id;
    perform public._payout_actor(p_actor_id,v_route.cabinet_id,array['finance','director']);
    if v_receipt.account_id<>v_route.receiving_account_id then
      raise exception using errcode='P0001',message='ACCOUNT_MISMATCH';
    end if;
    if v_route.require_exact_payer_inn and (
      v_identity->>'source' not in ('bank_import_structured','manual_verified')
      or (v_identity->>'verified')::boolean is not true
      or v_identity->>'payerInn' is distinct from v_route.payer_inn) then
      raise exception using errcode='P0001',message='PAYER_IDENTITY_MISMATCH';
    end if;
    if (select pg_catalog.coalesce(pg_catalog.sum(a.allocated_amount),0)
      from public.marketplace_payout_receipt_allocations a
      join public.marketplace_payout_receipt_reconciliations r on r.id=a.reconciliation_id
      where a.forecast_line_id=v_line.id and r.state='active' and r.id<>pg_catalog.coalesce(v_old,pg_catalog.gen_random_uuid()))
      +(v_alloc->>'allocatedAmount')::numeric>v_line.amount then
      raise exception using errcode='P0001',message='FORECAST_OVERALLOCATED';
    end if;
  end loop;
  insert into public.marketplace_payout_receipt_reconciliations(
    receipt_payment_id,state,receipt_amount_snapshot,payer_inn,payer_kpp,payer_legal_name,
    payer_account_number,identity_source,identity_verified,unresolved_amount,
    unresolved_reason,created_by)
  values(v_receipt.id,'active',v_receipt.amount,v_identity->>'payerInn',
    v_identity->>'payerKpp',v_identity->>'payerLegalName',v_identity->>'payerAccountNumber',
    v_identity->>'source',(v_identity->>'verified')::boolean,
    (p_request->>'unresolvedAmount')::numeric,nullif(p_request->>'unresolvedReason',''),p_actor_id)
  returning id into v_recon;
  for v_alloc in select value from pg_catalog.jsonb_array_elements(p_request->'allocations') loop
    insert into public.marketplace_payout_receipt_allocations(
      reconciliation_id,forecast_line_id,allocated_amount)
    values(v_recon,(v_alloc->>'forecastLineId')::uuid,(v_alloc->>'allocatedAmount')::numeric);
  end loop;
  update public.marketplace_payout_forecast_lines l set lifecycle_state=case
    when x.allocated=0 then 'marketplace_scheduled'
    when x.allocated<l.amount then 'partially_received' else 'bank_received' end
  from (select affected.forecast_line_id,
      pg_catalog.coalesce(pg_catalog.sum(a.allocated_amount)
        filter (where r.state='active'),0) allocated
    from (select forecast_line_id from public.marketplace_payout_receipt_allocations
           where reconciliation_id in (v_old,v_recon)
         union
         select (z->>'forecastLineId')::uuid
           from pg_catalog.jsonb_array_elements(p_request->'allocations') z) affected
    left join public.marketplace_payout_receipt_allocations a
      on a.forecast_line_id=affected.forecast_line_id
    left join public.marketplace_payout_receipt_reconciliations r
      on r.id=a.reconciliation_id
    group by affected.forecast_line_id) x
  where l.id=x.forecast_line_id;
  v_result:=pg_catalog.jsonb_build_object('ok',true,'reconciliationId',v_recon,
    'receiptPaymentId',v_receipt.id,'state','active');
  insert into public.marketplace_payout_audit(request_id,actor_id,operation,request_hash,
    request_json,result_json,reconciliation_id)
  values(v_request_id,p_actor_id,'reconcile',v_hash,p_request,v_result,v_recon);
  return v_result;
exception when no_data_found then
  raise exception using errcode='P0001',message='RECONCILIATION_TARGET_NOT_FOUND';
end
$fn$;

alter function public._payout_actor(uuid,uuid,text[]) owner to payout_rpc_owner;
alter function public._payout_assert_keys(jsonb,text[],text[]) owner to payout_rpc_owner;
alter function public._payout_request_hash(jsonb) owner to payout_rpc_owner;
alter function public._payout_replay(uuid,uuid,text,bytea) owner to payout_rpc_owner;
alter function public._payout_immutable_guard() owner to payout_rpc_owner;
alter function public._payout_route_guard() owner to payout_rpc_owner;
alter function public._payout_route_validate() owner to payout_rpc_owner;
alter function public._payout_revision_guard() owner to payout_rpc_owner;
alter function public._payout_audit_guard() owner to payout_rpc_owner;
alter function public.preview_marketplace_payout(jsonb,uuid) owner to payout_rpc_owner;
alter function public.approve_marketplace_payout(jsonb,uuid) owner to payout_rpc_owner;
alter function public.publish_marketplace_payout(jsonb,uuid) owner to payout_rpc_owner;
alter function public.reconcile_marketplace_payout(jsonb,uuid) owner to payout_rpc_owner;

revoke all on function public._payout_actor(uuid,uuid,text[]),
  public._payout_assert_keys(jsonb,text[],text[]),
  public._payout_request_hash(jsonb),
  public._payout_replay(uuid,uuid,text,bytea),
  public._payout_immutable_guard(), public._payout_route_guard(),
  public._payout_route_validate(),
  public._payout_revision_guard(),
  public._payout_audit_guard()
from public, anon, authenticated, service_role, payout_rpc_executor;
revoke all on function public.preview_marketplace_payout(jsonb,uuid),
  public.approve_marketplace_payout(jsonb,uuid),
  public.publish_marketplace_payout(jsonb,uuid),
  public.reconcile_marketplace_payout(jsonb,uuid)
from public, anon, authenticated, service_role;
grant execute on function public.preview_marketplace_payout(jsonb,uuid),
  public.approve_marketplace_payout(jsonb,uuid),
  public.publish_marketplace_payout(jsonb,uuid),
  public.reconcile_marketplace_payout(jsonb,uuid)
to payout_rpc_executor;
