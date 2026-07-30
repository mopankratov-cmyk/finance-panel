-- Marketplace payout DDL invariants v6.
-- Normative matrix SHA-256:
-- cd5c2e7a9cce73304418f080055b840bd8104cea31be8ac8f731325242d973df
-- Implemented families: C-*, T-*, ACL-*.
-- Hosted Supabase PostgreSQL 17 compatibility amendment:
-- ACL-M-01/02 forbid every effective/runtime membership. The only accepted
-- catalog exception is the platform-created ADMIN-only edge from each payout
-- role to MIGRATION_ADMIN, granted by supabase_admin with INHERIT=false and
-- SET=false. It does not expand MIGRATION_ADMIN's existing authority and gives
-- no application role access. Every other edge still fails closed.
-- Runtime orchestration contract: GATE-* (implemented by the separate runner).
-- Deferred family: OP-* business RPC operations.
--
-- This migration is additive. It must run inside one transaction and it must not
-- alter existing finance business tables.

-- The lock is deliberately a separate statement. Under READ COMMITTED a waiter
-- then starts the collision check below with a new snapshot, so concurrent
-- migration attempts return our stable role-collision oracle instead of a
-- PostgreSQL duplicate-role error.
select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('finance-panel:marketplace-payout:roles:v6', 0)
);

do $marketplace_payout_preflight$
declare
  role_name text;
begin
  foreach role_name in array array[
    'payout_rpc_owner',
    'payout_rpc_executor'
  ]
  loop
    if exists (
      select 1
      from pg_catalog.pg_roles
      where rolname = role_name
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'PAYOUT_ROLE_COLLISION:' || role_name;
    end if;
  end loop;

  foreach role_name in array array[
    'anon',
    'authenticated',
    'service_role'
  ]
  loop
    if not exists (
      select 1
      from pg_catalog.pg_roles
      where rolname = role_name
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'PAYOUT_REQUIRED_ROLE_MISSING:' || role_name;
    end if;

    if pg_catalog.has_schema_privilege(role_name, 'public', 'CREATE') then
      raise exception using
        errcode = '42501',
        message = 'PAYOUT_PUBLIC_SCHEMA_CREATE_BASELINE_UNSAFE:' || role_name;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_namespace as namespace_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        namespace_row.nspacl,
        pg_catalog.acldefault('n', namespace_row.nspowner)
      )
    ) as privilege_row
    where namespace_row.nspname = 'public'
      and privilege_row.grantee = 0
      and privilege_row.privilege_type = 'CREATE'
  ) then
    raise exception using
      errcode = '42501',
      message = 'PAYOUT_PUBLIC_SCHEMA_CREATE_BASELINE_UNSAFE:PUBLIC';
  end if;
end
$marketplace_payout_preflight$;

create role payout_rpc_owner
  nologin
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  noinherit;

create role payout_rpc_executor
  nologin
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  noinherit;

-- PostgreSQL 17 grants a role created by a CREATEROLE user back to its
-- creator. Revoke the portable/current-grantor edge immediately. Hosted
-- Supabase records a separate, non-inheritable/non-settable administrative
-- edge granted by supabase_admin; the final postcondition below permits only
-- that exact platform edge.
revoke payout_rpc_executor from current_user;

grant payout_rpc_owner to current_user
  with admin false, inherit true, set true;

grant usage, create on schema public to payout_rpc_owner;
grant usage on schema public to payout_rpc_executor;

create table public.marketplace_payout_routes (
  id uuid not null default pg_catalog.gen_random_uuid(),
  marketplace text not null,
  cabinet_id uuid not null,
  company_id uuid not null,
  receiving_account_id uuid not null,
  payer_inn text not null,
  payer_kpp text,
  payer_legal_name text not null,
  account_kind text not null,
  require_exact_payer_inn boolean not null,
  is_active boolean not null default true,
  valid_from timestamptz not null default pg_catalog.clock_timestamp(),
  retired_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_by uuid not null,

  constraint marketplace_payout_routes_pkey
    primary key (id),
  constraint marketplace_payout_routes_marketplace_ck
    check (marketplace in ('ozon', 'wb')),
  constraint marketplace_payout_routes_payer_inn_ck
    check (payer_inn ~ '^[0-9]{10}([0-9]{2})?$'),
  constraint marketplace_payout_routes_payer_kpp_ck
    check (payer_kpp is null or payer_kpp ~ '^[0-9]{9}$'),
  constraint marketplace_payout_routes_payer_legal_name_ck
    check (pg_catalog.btrim(payer_legal_name) <> ''),
  constraint marketplace_payout_routes_account_kind_ck
    check (account_kind in ('dedicated_marketplace', 'shared')),
  constraint marketplace_payout_routes_shared_exact_inn_ck
    check (account_kind <> 'shared' or require_exact_payer_inn),
  constraint marketplace_payout_routes_active_retired_ck
    check (is_active = (retired_at is null)),
  constraint marketplace_payout_routes_retired_after_valid_from_ck
    check (retired_at is null or retired_at > valid_from),
  constraint marketplace_payout_routes_created_by_fk
    foreign key (created_by)
    references public.app_users(id)
    on delete restrict,
  constraint marketplace_payout_routes_cabinet_fk
    foreign key (cabinet_id)
    references public.wb_cabinets(id)
    on delete restrict,
  constraint marketplace_payout_routes_company_fk
    foreign key (company_id)
    references public.companies(id)
    on delete restrict,
  constraint marketplace_payout_routes_account_fk
    foreign key (receiving_account_id)
    references public.accounts(id)
    on delete restrict,
  constraint marketplace_payout_routes_scope_uq
    unique (id, marketplace, cabinet_id, company_id, receiving_account_id)
);

create unique index marketplace_payout_routes_one_active_per_cabinet_uq
  on public.marketplace_payout_routes(marketplace, cabinet_id)
  where is_active;

create index marketplace_payout_routes_receipt_match_idx
  on public.marketplace_payout_routes(
    receiving_account_id,
    payer_inn,
    marketplace
  )
  where is_active;

create table public.marketplace_payout_series (
  id uuid not null default pg_catalog.gen_random_uuid(),
  marketplace text not null,
  cabinet_id uuid not null,
  company_id uuid not null,
  series_key text not null,
  latest_revision bigint not null default 0,
  current_published_revision bigint not null default 0,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),

  constraint marketplace_payout_series_pkey
    primary key (id),
  constraint marketplace_payout_series_marketplace_ck
    check (marketplace in ('ozon', 'wb')),
  constraint marketplace_payout_series_series_key_ck
    check (pg_catalog.btrim(series_key) <> ''),
  constraint marketplace_payout_series_latest_revision_ck
    check (latest_revision >= 0),
  constraint marketplace_payout_series_current_revision_ck
    check (
      current_published_revision >= 0
      and current_published_revision <= latest_revision
    ),
  constraint marketplace_payout_series_cabinet_fk
    foreign key (cabinet_id)
    references public.wb_cabinets(id)
    on delete restrict,
  constraint marketplace_payout_series_company_fk
    foreign key (company_id)
    references public.companies(id)
    on delete restrict,
  constraint marketplace_payout_series_scope_key_uq
    unique (marketplace, cabinet_id, company_id, series_key),
  constraint marketplace_payout_series_scope_uq
    unique (id, marketplace, cabinet_id, company_id)
);

create table public.marketplace_payout_forecast_revisions (
  id uuid not null default pg_catalog.gen_random_uuid(),
  series_id uuid not null,
  marketplace text not null,
  cabinet_id uuid not null,
  company_id uuid not null,
  route_id uuid not null,
  receiving_account_id uuid not null,
  revision bigint not null,
  publication_state text not null,
  payload_hash bytea not null,
  source_observed_at timestamptz not null,
  source_data_status text not null,
  unallocated_amount numeric(18, 2) not null default 0,
  unresolved_receipt_count integer not null default 0,
  approved_at timestamptz,
  approved_by uuid,
  published_at timestamptz,
  published_by uuid,
  superseded_at timestamptz,
  superseded_by_version_id uuid,
  discarded_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),

  constraint marketplace_payout_forecast_revisions_pkey
    primary key (id),
  constraint marketplace_payout_forecast_revisions_revision_ck
    check (revision > 0),
  constraint marketplace_payout_forecast_revisions_state_ck
    check (
      publication_state in (
        'previewed',
        'approved',
        'published',
        'superseded',
        'discarded'
      )
    ),
  constraint marketplace_payout_forecast_revisions_payload_hash_ck
    check (pg_catalog.octet_length(payload_hash) = 32),
  constraint marketplace_payout_forecast_revisions_source_status_ck
    check (source_data_status = 'available'),
  constraint marketplace_payout_forecast_revisions_unallocated_ck
    check (unallocated_amount >= 0),
  constraint marketplace_payout_forecast_revisions_unresolved_count_ck
    check (unresolved_receipt_count >= 0),
  constraint marketplace_payout_forecast_revisions_approval_pair_ck
    check (
      (approved_at is null and approved_by is null)
      or (approved_at is not null and approved_by is not null)
    ),
  constraint marketplace_payout_forecast_revisions_publication_pair_ck
    check (
      (published_at is null and published_by is null)
      or (published_at is not null and published_by is not null)
    ),
  constraint marketplace_payout_forecast_revisions_supersession_pair_ck
    check (
      (superseded_at is null and superseded_by_version_id is null)
      or (
        superseded_at is not null
        and superseded_by_version_id is not null
      )
    ),
  constraint marketplace_payout_forecast_revisions_state_metadata_ck
    check (
      (
        publication_state = 'previewed'
        and approved_at is null
        and approved_by is null
        and published_at is null
        and published_by is null
        and superseded_at is null
        and superseded_by_version_id is null
        and discarded_at is null
      )
      or (
        publication_state = 'approved'
        and approved_at is not null
        and approved_by is not null
        and published_at is null
        and published_by is null
        and superseded_at is null
        and superseded_by_version_id is null
        and discarded_at is null
      )
      or (
        publication_state = 'published'
        and approved_at is not null
        and approved_by is not null
        and published_at is not null
        and published_by is not null
        and superseded_at is null
        and superseded_by_version_id is null
        and discarded_at is null
      )
      or (
        publication_state = 'superseded'
        and approved_at is not null
        and approved_by is not null
        and published_at is not null
        and published_by is not null
        and superseded_at is not null
        and superseded_by_version_id is not null
        and discarded_at is null
      )
      or (
        publication_state = 'discarded'
        and published_at is null
        and published_by is null
        and superseded_at is null
        and superseded_by_version_id is null
        and discarded_at is not null
        and (
          (approved_at is null and approved_by is null)
          or (approved_at is not null and approved_by is not null)
        )
      )
    ),
  constraint marketplace_payout_forecast_revisions_not_self_superseded_ck
    check (
      superseded_by_version_id is null
      or superseded_by_version_id <> id
    ),
  constraint marketplace_payout_forecast_revisions_approved_by_fk
    foreign key (approved_by)
    references public.app_users(id)
    on delete restrict,
  constraint marketplace_payout_forecast_revisions_published_by_fk
    foreign key (published_by)
    references public.app_users(id)
    on delete restrict,
  constraint marketplace_payout_forecast_revisions_superseder_fk
    foreign key (superseded_by_version_id)
    references public.marketplace_payout_forecast_revisions(id)
    on delete restrict,
  constraint marketplace_payout_forecast_revisions_series_scope_fk
    foreign key (series_id, marketplace, cabinet_id, company_id)
    references public.marketplace_payout_series(
      id,
      marketplace,
      cabinet_id,
      company_id
    )
    on delete restrict,
  constraint marketplace_payout_forecast_revisions_route_scope_fk
    foreign key (
      route_id,
      marketplace,
      cabinet_id,
      company_id,
      receiving_account_id
    )
    references public.marketplace_payout_routes(
      id,
      marketplace,
      cabinet_id,
      company_id,
      receiving_account_id
    )
    on delete restrict,
  constraint marketplace_payout_forecast_revisions_series_revision_uq
    unique (series_id, revision)
);

create unique index marketplace_payout_versions_one_open_draft_uq
  on public.marketplace_payout_forecast_revisions(series_id)
  where publication_state in ('previewed', 'approved');

create unique index marketplace_payout_versions_one_published_uq
  on public.marketplace_payout_forecast_revisions(series_id)
  where publication_state = 'published';

create index marketplace_payout_versions_history_idx
  on public.marketplace_payout_forecast_revisions(series_id, revision desc);

create table public.marketplace_payout_forecast_lines (
  id uuid not null default pg_catalog.gen_random_uuid(),
  version_id uuid not null,
  line_key text not null,
  source_kind text not null,
  provider_report_id text,
  provider_schedule_id text,
  period_from date,
  period_to date,
  expected_receipt_date date not null,
  amount numeric(18, 2) not null,
  currency text not null default 'RUB',
  lifecycle_state text not null,
  payment_id uuid,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),

  constraint marketplace_payout_forecast_lines_pkey
    primary key (id),
  constraint marketplace_payout_forecast_lines_line_key_ck
    check (pg_catalog.btrim(line_key) <> ''),
  constraint marketplace_payout_forecast_lines_source_kind_ck
    check (source_kind in ('forecast', 'provider_report')),
  constraint marketplace_payout_forecast_lines_amount_ck
    check (amount > 0),
  constraint marketplace_payout_forecast_lines_currency_ck
    check (currency ~ '^[A-Z]{3}$'),
  constraint marketplace_payout_forecast_lines_lifecycle_ck
    check (
      lifecycle_state in (
        'forecast',
        'report_confirmed',
        'marketplace_scheduled',
        'partially_received',
        'bank_received'
      )
    ),
  constraint marketplace_payout_forecast_lines_period_pair_ck
    check (
      (period_from is null and period_to is null)
      or (period_from is not null and period_to is not null)
    ),
  constraint marketplace_payout_forecast_lines_period_order_ck
    check (period_to is null or period_to >= period_from),
  constraint marketplace_payout_forecast_lines_report_identity_ck
    check (
      (
        source_kind = 'forecast'
        and provider_report_id is null
      )
      or (
        source_kind = 'provider_report'
        and provider_report_id is not null
        and pg_catalog.btrim(provider_report_id) <> ''
      )
    ),
  constraint marketplace_payout_forecast_lines_report_state_ck
    check (
      lifecycle_state <> 'report_confirmed'
      or source_kind = 'provider_report'
    ),
  constraint marketplace_payout_forecast_lines_payment_state_ck
    check (
      payment_id is null
      or lifecycle_state in (
        'marketplace_scheduled',
        'partially_received',
        'bank_received'
      )
    ),
  constraint marketplace_payout_forecast_lines_version_fk
    foreign key (version_id)
    references public.marketplace_payout_forecast_revisions(id)
    on delete restrict,
  constraint marketplace_payout_forecast_lines_payment_fk
    foreign key (payment_id)
    references public.payments(id)
    on delete restrict,
  constraint marketplace_payout_forecast_lines_version_line_key_uq
    unique (version_id, line_key)
);

create unique index marketplace_payout_lines_report_per_version_uq
  on public.marketplace_payout_forecast_lines(
    version_id,
    provider_report_id
  )
  where provider_report_id is not null;

create unique index marketplace_payout_lines_payment_uq
  on public.marketplace_payout_forecast_lines(payment_id)
  where payment_id is not null;

create index marketplace_payout_lines_version_idx
  on public.marketplace_payout_forecast_lines(version_id, id);

create table public.marketplace_payout_receipt_reconciliations (
  id uuid not null default pg_catalog.gen_random_uuid(),
  receipt_payment_id uuid not null,
  state text not null,
  receipt_amount_snapshot numeric(18, 2) not null,
  payer_inn text,
  payer_kpp text,
  payer_legal_name text,
  payer_account_number text,
  identity_source text not null,
  identity_verified boolean not null,
  unresolved_amount numeric(18, 2) not null default 0,
  unresolved_reason text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_by uuid not null,
  reversed_at timestamptz,
  reversed_by uuid,
  reversal_reason text,

  constraint marketplace_payout_receipt_reconciliations_pkey
    primary key (id),
  constraint marketplace_payout_receipt_reconciliations_state_ck
    check (state in ('active', 'reversed')),
  constraint marketplace_payout_receipt_reconciliations_amount_ck
    check (receipt_amount_snapshot > 0),
  constraint marketplace_payout_receipt_reconciliations_payer_inn_ck
    check (
      payer_inn is null
      or payer_inn ~ '^[0-9]{10}([0-9]{2})?$'
    ),
  constraint marketplace_payout_receipt_reconciliations_payer_kpp_ck
    check (payer_kpp is null or payer_kpp ~ '^[0-9]{9}$'),
  constraint marketplace_payout_receipt_reconciliations_identity_source_ck
    check (
      identity_source in (
        'bank_import_structured',
        'manual_verified',
        'legacy_text'
      )
    ),
  constraint marketplace_payout_receipt_reconciliations_unresolved_amount_ck
    check (
      unresolved_amount >= 0
      and unresolved_amount <= receipt_amount_snapshot
    ),
  constraint marketplace_payout_receipt_reconciliations_unresolved_reason_ck
    check (
      unresolved_reason is null
      or unresolved_reason in (
        'unlinked',
        'ambiguous',
        'partial',
        'payer_unverified',
        'company_mismatch',
        'account_mismatch'
      )
    ),
  constraint marketplace_payout_receipt_reconciliations_unresolved_pair_ck
    check (
      (unresolved_amount = 0 and unresolved_reason is null)
      or (unresolved_amount > 0 and unresolved_reason is not null)
    ),
  constraint marketplace_payout_receipt_reconciliations_reversal_triple_ck
    check (
      (
        reversed_at is null
        and reversed_by is null
        and reversal_reason is null
      )
      or (
        reversed_at is not null
        and reversed_by is not null
        and reversal_reason is not null
        and pg_catalog.btrim(reversal_reason) <> ''
      )
    ),
  constraint marketplace_payout_receipt_reconciliations_state_metadata_ck
    check (
      (
        state = 'active'
        and reversed_at is null
        and reversed_by is null
        and reversal_reason is null
      )
      or (
        state = 'reversed'
        and reversed_at is not null
        and reversed_by is not null
        and reversal_reason is not null
        and pg_catalog.btrim(reversal_reason) <> ''
      )
    ),
  constraint marketplace_payout_receipt_reconciliations_legacy_unverified_ck
    check (
      identity_source <> 'legacy_text'
      or identity_verified = false
    ),
  constraint marketplace_payout_receipt_reconciliations_receipt_fk
    foreign key (receipt_payment_id)
    references public.payments(id)
    on delete restrict,
  constraint marketplace_payout_receipt_reconciliations_created_by_fk
    foreign key (created_by)
    references public.app_users(id)
    on delete restrict,
  constraint marketplace_payout_receipt_reconciliations_reversed_by_fk
    foreign key (reversed_by)
    references public.app_users(id)
    on delete restrict
);

create unique index marketplace_payout_receipts_one_active_uq
  on public.marketplace_payout_receipt_reconciliations(receipt_payment_id)
  where state = 'active';

create table public.marketplace_payout_receipt_allocations (
  id uuid not null default pg_catalog.gen_random_uuid(),
  reconciliation_id uuid not null,
  forecast_line_id uuid not null,
  allocated_amount numeric(18, 2) not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),

  constraint marketplace_payout_receipt_allocations_pkey
    primary key (id),
  constraint marketplace_payout_receipt_allocations_amount_ck
    check (allocated_amount > 0),
  constraint marketplace_payout_receipt_allocations_reconciliation_fk
    foreign key (reconciliation_id)
    references public.marketplace_payout_receipt_reconciliations(id)
    on delete restrict,
  constraint marketplace_payout_receipt_allocations_line_fk
    foreign key (forecast_line_id)
    references public.marketplace_payout_forecast_lines(id)
    on delete restrict,
  constraint marketplace_payout_receipt_allocations_reconciliation_line_uq
    unique (reconciliation_id, forecast_line_id)
);

create index marketplace_payout_allocations_line_idx
  on public.marketplace_payout_receipt_allocations(forecast_line_id);

create index marketplace_payout_allocations_reconciliation_idx
  on public.marketplace_payout_receipt_allocations(reconciliation_id);

create table public.marketplace_payout_audit (
  id bigint generated always as identity
    (sequence name public.marketplace_payout_audit_id_seq)
    not null,
  operation_id uuid not null default pg_catalog.gen_random_uuid(),
  request_id uuid not null,
  actor_id uuid not null,
  operation text not null,
  request_hash bytea not null,
  request_json jsonb not null,
  result_json jsonb not null,
  series_id uuid,
  version_id uuid,
  reconciliation_id uuid,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),

  constraint marketplace_payout_audit_pkey
    primary key (id),
  constraint marketplace_payout_audit_operation_ck
    check (
      operation in (
        'preview',
        'approve',
        'publish',
        'replace',
        'reconcile',
        'correct',
        'reverse',
        'discard',
        'route_create',
        'route_retire'
      )
    ),
  constraint marketplace_payout_audit_request_hash_ck
    check (pg_catalog.octet_length(request_hash) = 32),
  constraint marketplace_payout_audit_request_json_object_ck
    check (pg_catalog.jsonb_typeof(request_json) = 'object'),
  constraint marketplace_payout_audit_result_json_object_ck
    check (pg_catalog.jsonb_typeof(result_json) = 'object'),
  constraint marketplace_payout_audit_actor_fk
    foreign key (actor_id)
    references public.app_users(id)
    on delete restrict,
  constraint marketplace_payout_audit_series_fk
    foreign key (series_id)
    references public.marketplace_payout_series(id)
    on delete restrict,
  constraint marketplace_payout_audit_version_fk
    foreign key (version_id)
    references public.marketplace_payout_forecast_revisions(id)
    on delete restrict,
  constraint marketplace_payout_audit_reconciliation_fk
    foreign key (reconciliation_id)
    references public.marketplace_payout_receipt_reconciliations(id)
    on delete restrict,
  constraint marketplace_payout_audit_operation_id_uq
    unique (operation_id),
  constraint marketplace_payout_audit_actor_request_uq
    unique (actor_id, request_id)
);

create index marketplace_payout_audit_series_idx
  on public.marketplace_payout_audit(series_id, created_at desc);

create function public._marketplace_payout_guard_route()
returns trigger
language plpgsql
security definer
set search_path = ''
as $marketplace_payout_guard_route$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'PAYOUT_ROUTE_DELETE_FORBIDDEN';
  end if;

  if not (
    old.is_active
    and not new.is_active
    and old.retired_at is null
    and new.retired_at is not null
    and new.retired_at > old.valid_from
    and old.id is not distinct from new.id
    and old.marketplace is not distinct from new.marketplace
    and old.cabinet_id is not distinct from new.cabinet_id
    and old.company_id is not distinct from new.company_id
    and old.receiving_account_id
      is not distinct from new.receiving_account_id
    and old.payer_inn is not distinct from new.payer_inn
    and old.payer_kpp is not distinct from new.payer_kpp
    and old.payer_legal_name is not distinct from new.payer_legal_name
    and old.account_kind is not distinct from new.account_kind
    and old.require_exact_payer_inn
      is not distinct from new.require_exact_payer_inn
    and old.valid_from is not distinct from new.valid_from
    and old.created_at is not distinct from new.created_at
    and old.created_by is not distinct from new.created_by
  ) then
    raise exception using
      errcode = '55000',
      message = 'PAYOUT_ROUTE_MUTATION_FORBIDDEN';
  end if;

  return new;
end
$marketplace_payout_guard_route$;

create function public._marketplace_payout_guard_series()
returns trigger
language plpgsql
security definer
set search_path = ''
as $marketplace_payout_guard_series$
declare
  candidate_state text;
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'PAYOUT_SERIES_DELETE_FORBIDDEN';
  end if;

  if not (
    old.id is not distinct from new.id
    and old.marketplace is not distinct from new.marketplace
    and old.cabinet_id is not distinct from new.cabinet_id
    and old.company_id is not distinct from new.company_id
    and old.series_key is not distinct from new.series_key
    and old.created_at is not distinct from new.created_at
  ) then
    raise exception using
      errcode = '55000',
      message = 'PAYOUT_SERIES_MUTATION_FORBIDDEN';
  end if;

  if (
    new.latest_revision = old.latest_revision + 1
    and new.current_published_revision = old.current_published_revision
  ) then
    if not exists (
      select 1
      from public.marketplace_payout_forecast_revisions as revision_row
      where revision_row.series_id = old.id
        and revision_row.revision = new.latest_revision
        and revision_row.publication_state in ('previewed', 'approved')
    ) then
      raise exception using
        errcode = '55000',
        message = 'PAYOUT_SERIES_MUTATION_FORBIDDEN';
    end if;
    return new;
  end if;

  if (
    new.latest_revision = old.latest_revision
    and new.current_published_revision > old.current_published_revision
    and new.current_published_revision <= old.latest_revision
  ) then
    select revision_row.publication_state
    into candidate_state
    from public.marketplace_payout_forecast_revisions as revision_row
    where revision_row.series_id = old.id
      and revision_row.revision = new.current_published_revision;

    if candidate_state is distinct from 'approved' then
      raise exception using
        errcode = '55000',
        message = 'PAYOUT_SERIES_MUTATION_FORBIDDEN';
    end if;
    return new;
  end if;

  raise exception using
    errcode = '55000',
    message = 'PAYOUT_SERIES_MUTATION_FORBIDDEN';
end
$marketplace_payout_guard_series$;

create function public._marketplace_payout_guard_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $marketplace_payout_guard_revision$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'PAYOUT_REVISION_DELETE_FORBIDDEN';
  end if;

  if not (
    old.id is not distinct from new.id
    and old.series_id is not distinct from new.series_id
    and old.marketplace is not distinct from new.marketplace
    and old.cabinet_id is not distinct from new.cabinet_id
    and old.company_id is not distinct from new.company_id
    and old.route_id is not distinct from new.route_id
    and old.receiving_account_id
      is not distinct from new.receiving_account_id
    and old.revision is not distinct from new.revision
    and old.payload_hash is not distinct from new.payload_hash
    and old.source_observed_at is not distinct from new.source_observed_at
    and old.source_data_status is not distinct from new.source_data_status
    and old.unallocated_amount is not distinct from new.unallocated_amount
    and old.unresolved_receipt_count
      is not distinct from new.unresolved_receipt_count
    and old.created_at is not distinct from new.created_at
  ) then
    raise exception using
      errcode = '55000',
      message = 'PAYOUT_REVISION_SNAPSHOT_IMMUTABLE';
  end if;

  if (
    old.publication_state = 'previewed'
    and new.publication_state = 'approved'
    and old.approved_at is null
    and old.approved_by is null
    and new.approved_at is not null
    and new.approved_by is not null
    and old.published_at is not distinct from new.published_at
    and old.published_by is not distinct from new.published_by
    and old.superseded_at is not distinct from new.superseded_at
    and old.superseded_by_version_id
      is not distinct from new.superseded_by_version_id
    and old.discarded_at is not distinct from new.discarded_at
  ) or (
    old.publication_state = 'previewed'
    and new.publication_state = 'discarded'
    and old.approved_at is not distinct from new.approved_at
    and old.approved_by is not distinct from new.approved_by
    and old.published_at is not distinct from new.published_at
    and old.published_by is not distinct from new.published_by
    and old.superseded_at is not distinct from new.superseded_at
    and old.superseded_by_version_id
      is not distinct from new.superseded_by_version_id
    and old.discarded_at is null
    and new.discarded_at is not null
  ) or (
    old.publication_state = 'approved'
    and new.publication_state = 'published'
    and old.approved_at is not distinct from new.approved_at
    and old.approved_by is not distinct from new.approved_by
    and old.published_at is null
    and old.published_by is null
    and new.published_at is not null
    and new.published_by is not null
    and old.superseded_at is not distinct from new.superseded_at
    and old.superseded_by_version_id
      is not distinct from new.superseded_by_version_id
    and old.discarded_at is not distinct from new.discarded_at
  ) or (
    old.publication_state = 'approved'
    and new.publication_state = 'discarded'
    and old.approved_at is not distinct from new.approved_at
    and old.approved_by is not distinct from new.approved_by
    and old.published_at is not distinct from new.published_at
    and old.published_by is not distinct from new.published_by
    and old.superseded_at is not distinct from new.superseded_at
    and old.superseded_by_version_id
      is not distinct from new.superseded_by_version_id
    and old.discarded_at is null
    and new.discarded_at is not null
  ) or (
    old.publication_state = 'published'
    and new.publication_state = 'superseded'
    and old.approved_at is not distinct from new.approved_at
    and old.approved_by is not distinct from new.approved_by
    and old.published_at is not distinct from new.published_at
    and old.published_by is not distinct from new.published_by
    and old.superseded_at is null
    and old.superseded_by_version_id is null
    and new.superseded_at is not null
    and new.superseded_by_version_id is not null
    and old.discarded_at is not distinct from new.discarded_at
  ) then
    return new;
  end if;

  raise exception using
    errcode = '55000',
    message = 'PAYOUT_REVISION_TRANSITION_FORBIDDEN';
end
$marketplace_payout_guard_revision$;

create function public._marketplace_payout_guard_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $marketplace_payout_guard_line$
declare
  active_allocated numeric(18, 2);
begin
  if tg_op = 'INSERT' then
    if (
      new.lifecycle_state in ('forecast', 'report_confirmed')
      and new.payment_id is null
    ) then
      return new;
    end if;

    raise exception using
      errcode = '55000',
      message = 'PAYOUT_LINE_TRANSITION_FORBIDDEN';
  end if;

  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'PAYOUT_LINE_DELETE_FORBIDDEN';
  end if;

  if not (
    old.id is not distinct from new.id
    and old.version_id is not distinct from new.version_id
    and old.line_key is not distinct from new.line_key
    and old.source_kind is not distinct from new.source_kind
    and old.provider_report_id is not distinct from new.provider_report_id
    and old.provider_schedule_id
      is not distinct from new.provider_schedule_id
    and old.period_from is not distinct from new.period_from
    and old.period_to is not distinct from new.period_to
    and old.expected_receipt_date
      is not distinct from new.expected_receipt_date
    and old.amount is not distinct from new.amount
    and old.currency is not distinct from new.currency
    and old.created_at is not distinct from new.created_at
  ) then
    raise exception using
      errcode = '55000',
      message = 'PAYOUT_LINE_SEMANTICS_IMMUTABLE';
  end if;

  if (
    old.lifecycle_state in ('forecast', 'report_confirmed')
    and new.lifecycle_state = 'marketplace_scheduled'
    and old.payment_id is null
    and new.payment_id is not null
  ) then
    return new;
  end if;

  if (
    old.lifecycle_state in (
      'marketplace_scheduled',
      'partially_received',
      'bank_received'
    )
    and new.lifecycle_state in (
      'marketplace_scheduled',
      'partially_received',
      'bank_received'
    )
    and new.lifecycle_state <> old.lifecycle_state
    and old.payment_id is not null
    and old.payment_id is not distinct from new.payment_id
  ) then
    if pg_catalog.current_setting('transaction_isolation') <> 'serializable' then
      raise exception using
        errcode = '55000',
        message = 'PAYOUT_LINE_TRANSITION_FORBIDDEN';
    end if;

    select coalesce(pg_catalog.sum(allocation_row.allocated_amount), 0)
    into active_allocated
    from public.marketplace_payout_receipt_allocations as allocation_row
    join public.marketplace_payout_receipt_reconciliations
      as reconciliation_row
      on reconciliation_row.id = allocation_row.reconciliation_id
    where allocation_row.forecast_line_id = old.id
      and reconciliation_row.state = 'active';

    if (
      (new.lifecycle_state = 'marketplace_scheduled' and active_allocated = 0)
      or (
        new.lifecycle_state = 'partially_received'
        and active_allocated > 0
        and active_allocated < old.amount
      )
      or (
        new.lifecycle_state = 'bank_received'
        and active_allocated = old.amount
      )
    ) then
      return new;
    end if;
  end if;

  raise exception using
    errcode = '55000',
    message = 'PAYOUT_LINE_TRANSITION_FORBIDDEN';
end
$marketplace_payout_guard_line$;

create function public._marketplace_payout_guard_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $marketplace_payout_guard_reconciliation$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'PAYOUT_RECONCILIATION_DELETE_FORBIDDEN';
  end if;

  if pg_catalog.current_setting('transaction_isolation') <> 'serializable' then
    raise exception using
      errcode = '55000',
      message = 'PAYOUT_RECONCILIATION_MUTATION_FORBIDDEN';
  end if;

  if (
    old.state = 'active'
    and new.state = 'reversed'
    and old.id is not distinct from new.id
    and old.receipt_payment_id is not distinct from new.receipt_payment_id
    and old.receipt_amount_snapshot
      is not distinct from new.receipt_amount_snapshot
    and old.payer_inn is not distinct from new.payer_inn
    and old.payer_kpp is not distinct from new.payer_kpp
    and old.payer_legal_name is not distinct from new.payer_legal_name
    and old.payer_account_number
      is not distinct from new.payer_account_number
    and old.identity_source is not distinct from new.identity_source
    and old.identity_verified is not distinct from new.identity_verified
    and old.unresolved_amount is not distinct from new.unresolved_amount
    and old.unresolved_reason is not distinct from new.unresolved_reason
    and old.created_at is not distinct from new.created_at
    and old.created_by is not distinct from new.created_by
    and old.reversed_at is null
    and old.reversed_by is null
    and old.reversal_reason is null
    and new.reversed_at is not null
    and new.reversed_by is not null
    and new.reversal_reason is not null
    and pg_catalog.btrim(new.reversal_reason) <> ''
  ) then
    perform 1
    from public.marketplace_payout_forecast_lines as line_row
    where line_row.id in (
      select allocation_row.forecast_line_id
      from public.marketplace_payout_receipt_allocations as allocation_row
      where allocation_row.reconciliation_id = old.id
    )
    order by line_row.id
    for update;

    return new;
  end if;

  raise exception using
    errcode = '55000',
    message = 'PAYOUT_RECONCILIATION_MUTATION_FORBIDDEN';
end
$marketplace_payout_guard_reconciliation$;

create function public._marketplace_payout_guard_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $marketplace_payout_guard_append_only$
declare
  reconciliation_state text;
begin
  if tg_table_name = 'marketplace_payout_receipt_allocations' then
    if tg_op = 'INSERT' then
      -- Let PostgreSQL emit the canonical declarative constraint first for
      -- malformed fixtures. Only a constraint-valid candidate enters the
      -- serialization protocol below.
      if (
        new.reconciliation_id is null
        or new.forecast_line_id is null
        or new.allocated_amount is null
        or new.allocated_amount <= 0
      ) then
        return new;
      end if;

      select reconciliation_row.state
      into reconciliation_state
      from public.marketplace_payout_receipt_reconciliations
        as reconciliation_row
      where reconciliation_row.id = new.reconciliation_id
      for update;

      if not found then
        return new;
      end if;

      perform 1
      from public.marketplace_payout_forecast_lines as line_row
      where line_row.id = new.forecast_line_id
      for update;

      if not found then
        return new;
      end if;

      if pg_catalog.current_setting('transaction_isolation') <> 'serializable' then
        raise exception using
          errcode = '55000',
          message = 'PAYOUT_ALLOCATION_APPEND_ONLY';
      end if;

      if reconciliation_state is distinct from 'active' then
        raise exception using
          errcode = '55000',
          message = 'PAYOUT_ALLOCATION_APPEND_ONLY';
      end if;

      return new;
    end if;

    raise exception using
      errcode = '55000',
      message = 'PAYOUT_ALLOCATION_APPEND_ONLY';
  end if;

  if tg_table_name = 'marketplace_payout_audit' then
    if tg_op = 'INSERT' then
      return new;
    end if;

    raise exception using
      errcode = '55000',
      message = 'PAYOUT_AUDIT_APPEND_ONLY';
  end if;

  raise exception using
    errcode = '55000',
    message = 'PAYOUT_AUDIT_APPEND_ONLY';
end
$marketplace_payout_guard_append_only$;

create trigger marketplace_payout_routes_guard_trg
before update or delete
on public.marketplace_payout_routes
for each row
execute function public._marketplace_payout_guard_route();

create trigger marketplace_payout_series_guard_trg
before update or delete
on public.marketplace_payout_series
for each row
execute function public._marketplace_payout_guard_series();

create trigger marketplace_payout_revisions_guard_trg
before update or delete
on public.marketplace_payout_forecast_revisions
for each row
execute function public._marketplace_payout_guard_revision();

create trigger marketplace_payout_lines_guard_trg
before update or delete
on public.marketplace_payout_forecast_lines
for each row
execute function public._marketplace_payout_guard_line();

create trigger marketplace_payout_lines_insert_guard_trg
after insert
on public.marketplace_payout_forecast_lines
for each row
execute function public._marketplace_payout_guard_line();

create trigger marketplace_payout_reconciliations_guard_trg
before update or delete
on public.marketplace_payout_receipt_reconciliations
for each row
execute function public._marketplace_payout_guard_reconciliation();

create trigger marketplace_payout_allocations_insert_guard_trg
before insert
on public.marketplace_payout_receipt_allocations
for each row
execute function public._marketplace_payout_guard_append_only();

create trigger marketplace_payout_allocations_append_only_trg
before update or delete
on public.marketplace_payout_receipt_allocations
for each row
execute function public._marketplace_payout_guard_append_only();

create trigger marketplace_payout_audit_append_only_trg
before insert or update or delete
on public.marketplace_payout_audit
for each row
execute function public._marketplace_payout_guard_append_only();

alter table public.marketplace_payout_routes enable row level security;
alter table public.marketplace_payout_series enable row level security;
alter table public.marketplace_payout_forecast_revisions
  enable row level security;
alter table public.marketplace_payout_forecast_lines
  enable row level security;
alter table public.marketplace_payout_receipt_reconciliations
  enable row level security;
alter table public.marketplace_payout_receipt_allocations
  enable row level security;
alter table public.marketplace_payout_audit enable row level security;

create policy marketplace_payout_routes_owner_select
on public.marketplace_payout_routes
as permissive
for select
to payout_rpc_owner
using (true);

create policy marketplace_payout_routes_owner_insert
on public.marketplace_payout_routes
as permissive
for insert
to payout_rpc_owner
with check (true);

create policy marketplace_payout_routes_owner_update
on public.marketplace_payout_routes
as permissive
for update
to payout_rpc_owner
using (true)
with check (true);

create policy marketplace_payout_series_owner_select
on public.marketplace_payout_series
as permissive
for select
to payout_rpc_owner
using (true);

create policy marketplace_payout_series_owner_insert
on public.marketplace_payout_series
as permissive
for insert
to payout_rpc_owner
with check (true);

create policy marketplace_payout_series_owner_update
on public.marketplace_payout_series
as permissive
for update
to payout_rpc_owner
using (true)
with check (true);

create policy marketplace_payout_revisions_owner_select
on public.marketplace_payout_forecast_revisions
as permissive
for select
to payout_rpc_owner
using (true);

create policy marketplace_payout_revisions_owner_insert
on public.marketplace_payout_forecast_revisions
as permissive
for insert
to payout_rpc_owner
with check (true);

create policy marketplace_payout_revisions_owner_update
on public.marketplace_payout_forecast_revisions
as permissive
for update
to payout_rpc_owner
using (true)
with check (true);

create policy marketplace_payout_lines_owner_select
on public.marketplace_payout_forecast_lines
as permissive
for select
to payout_rpc_owner
using (true);

create policy marketplace_payout_lines_owner_insert
on public.marketplace_payout_forecast_lines
as permissive
for insert
to payout_rpc_owner
with check (true);

create policy marketplace_payout_lines_owner_update
on public.marketplace_payout_forecast_lines
as permissive
for update
to payout_rpc_owner
using (true)
with check (true);

create policy marketplace_payout_reconciliations_owner_select
on public.marketplace_payout_receipt_reconciliations
as permissive
for select
to payout_rpc_owner
using (true);

create policy marketplace_payout_reconciliations_owner_insert
on public.marketplace_payout_receipt_reconciliations
as permissive
for insert
to payout_rpc_owner
with check (true);

create policy marketplace_payout_reconciliations_owner_update
on public.marketplace_payout_receipt_reconciliations
as permissive
for update
to payout_rpc_owner
using (true)
with check (true);

create policy marketplace_payout_allocations_owner_select
on public.marketplace_payout_receipt_allocations
as permissive
for select
to payout_rpc_owner
using (true);

create policy marketplace_payout_allocations_owner_insert
on public.marketplace_payout_receipt_allocations
as permissive
for insert
to payout_rpc_owner
with check (true);

create policy marketplace_payout_audit_owner_select
on public.marketplace_payout_audit
as permissive
for select
to payout_rpc_owner
using (true);

create policy marketplace_payout_audit_owner_insert
on public.marketplace_payout_audit
as permissive
for insert
to payout_rpc_owner
with check (true);

revoke all
on table
  public.marketplace_payout_routes,
  public.marketplace_payout_series,
  public.marketplace_payout_forecast_revisions,
  public.marketplace_payout_forecast_lines,
  public.marketplace_payout_receipt_reconciliations,
  public.marketplace_payout_receipt_allocations,
  public.marketplace_payout_audit
from public, anon, authenticated, service_role, payout_rpc_executor;

grant select, insert, update
on table
  public.marketplace_payout_routes,
  public.marketplace_payout_series,
  public.marketplace_payout_forecast_revisions,
  public.marketplace_payout_forecast_lines,
  public.marketplace_payout_receipt_reconciliations
to payout_rpc_owner;

grant select, insert
on table
  public.marketplace_payout_receipt_allocations,
  public.marketplace_payout_audit
to payout_rpc_owner;

revoke all
on sequence public.marketplace_payout_audit_id_seq
from public, anon, authenticated, service_role, payout_rpc_executor;

grant usage
on sequence public.marketplace_payout_audit_id_seq
to payout_rpc_owner;

alter function public._marketplace_payout_guard_route()
  owner to payout_rpc_owner;
alter function public._marketplace_payout_guard_series()
  owner to payout_rpc_owner;
alter function public._marketplace_payout_guard_revision()
  owner to payout_rpc_owner;
alter function public._marketplace_payout_guard_line()
  owner to payout_rpc_owner;
alter function public._marketplace_payout_guard_reconciliation()
  owner to payout_rpc_owner;
alter function public._marketplace_payout_guard_append_only()
  owner to payout_rpc_owner;

revoke all
on function
  public._marketplace_payout_guard_route(),
  public._marketplace_payout_guard_series(),
  public._marketplace_payout_guard_revision(),
  public._marketplace_payout_guard_line(),
  public._marketplace_payout_guard_reconciliation(),
  public._marketplace_payout_guard_append_only()
from public, anon, authenticated, service_role, payout_rpc_executor;

revoke create on schema public from payout_rpc_owner;
grant usage on schema public to payout_rpc_owner;
grant usage on schema public to payout_rpc_executor;

revoke payout_rpc_owner from current_user;

do $marketplace_payout_postconditions$
declare
  payout_membership_count integer;
  role_name text;
begin
  select pg_catalog.count(*)::integer
  into payout_membership_count
  from pg_catalog.pg_auth_members as membership
  join pg_catalog.pg_roles as granted_role
    on granted_role.oid = membership.roleid
  join pg_catalog.pg_roles as member_role
    on member_role.oid = membership.member
  where granted_role.rolname in (
    'payout_rpc_owner',
    'payout_rpc_executor'
  )
    or member_role.rolname in (
      'payout_rpc_owner',
      'payout_rpc_executor'
    );

  -- A vanilla superuser migration leaves zero edges. Supabase PostgreSQL 17
  -- necessarily leaves exactly one administrative edge for each created role:
  -- payout role -> migration admin, granted by supabase_admin, with ADMIN only.
  -- The edge cannot confer runtime privileges because INHERIT and SET are both
  -- false. Any other member, grantor, option set, direction, or partial state
  -- fails closed.
  if payout_membership_count not in (0, 2)
    or exists (
      select 1
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as granted_role
        on granted_role.oid = membership.roleid
      join pg_catalog.pg_roles as member_role
        on member_role.oid = membership.member
      join pg_catalog.pg_roles as grantor_role
        on grantor_role.oid = membership.grantor
      where (
        granted_role.rolname in (
          'payout_rpc_owner',
          'payout_rpc_executor'
        )
        or member_role.rolname in (
          'payout_rpc_owner',
          'payout_rpc_executor'
        )
      )
        and not (
          payout_membership_count = 2
          and granted_role.rolname in (
            'payout_rpc_owner',
            'payout_rpc_executor'
          )
          and member_role.rolname = current_user
          and grantor_role.rolname = 'supabase_admin'
          and membership.admin_option
          and not membership.inherit_option
          and not membership.set_option
        )
    )
    or (
      payout_membership_count = 2
      and (
        select pg_catalog.count(distinct granted_role.rolname)
        from pg_catalog.pg_auth_members as membership
        join pg_catalog.pg_roles as granted_role
          on granted_role.oid = membership.roleid
        where granted_role.rolname in (
          'payout_rpc_owner',
          'payout_rpc_executor'
        )
      ) <> 2
    )
  then
    raise exception using
      errcode = '42501',
      message = 'PAYOUT_ROLE_MEMBERSHIP_POSTCONDITION_FAILED';
  end if;

  foreach role_name in array array[
    'payout_rpc_owner',
    'payout_rpc_executor'
  ]
  loop
    if not pg_catalog.has_schema_privilege(role_name, 'public', 'USAGE')
      or pg_catalog.has_schema_privilege(role_name, 'public', 'CREATE')
    then
      raise exception using
        errcode = '42501',
        message = 'PAYOUT_SCHEMA_ACL_POSTCONDITION_FAILED:' || role_name;
    end if;
  end loop;
end
$marketplace_payout_postconditions$;
