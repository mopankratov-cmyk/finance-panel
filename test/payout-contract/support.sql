-- Disposable-database test support. All fixture UUIDs use the 91..99 test prefix.
create schema if not exists test_support;
revoke all on schema test_support from public;

create table if not exists test_support.generated_payment_ids (
  payment_id uuid primary key
);

create or replace function test_support.fail_second_planned_payment()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if pg_catalog.current_setting('application_name',true)='fault-second-payment'
    and (select pg_catalog.count(*) from test_support.generated_payment_ids)>=1 then
    raise exception using errcode='P0001',message='injected second payment failure';
  end if;
  if new.comment='[marketplace-payout-v2]' then
    insert into test_support.generated_payment_ids(payment_id) values(new.id);
  end if;
  return new;
end
$$;
drop trigger if exists payout_test_fail_second_payment on public.payments;
create trigger payout_test_fail_second_payment before insert on public.payments
for each row execute function test_support.fail_second_planned_payment();

create or replace function test_support.clean()
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_catalog.set_config('payout.test_cleanup','on',true);
  perform pg_catalog.set_config('payout.test_corruption_bypass','on',true);
  delete from public.marketplace_payout_audit where actor_id::text like '91%';
  delete from public.marketplace_payout_receipt_allocations where reconciliation_id in
    (select id from public.marketplace_payout_receipt_reconciliations where created_by::text like '91%');
  delete from public.marketplace_payout_receipt_reconciliations where created_by::text like '91%';
  delete from public.marketplace_payout_forecast_lines where version_id in
    (select id from public.marketplace_payout_forecast_revisions where cabinet_id::text like '92%');
  delete from public.marketplace_payout_forecast_revisions where cabinet_id::text like '92%';
  delete from public.marketplace_payout_series where cabinet_id::text like '92%';
  delete from public.marketplace_payout_routes where cabinet_id::text like '92%';
  delete from public.payments where id in (
    select payment_id from test_support.generated_payment_ids
    union all
    select id from public.payments where id::text like '95000000-0000-4000-8000-%'
  );
  delete from test_support.generated_payment_ids;
  delete from public.accounts where id::text like '94%';
  delete from public.companies where id::text like '93%';
  delete from public.wb_cabinets where id::text like '92%';
  delete from public.app_users where id::text like '91%';
end
$$;

create or replace function test_support.install_fixtures()
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform test_support.clean();
  insert into public.app_users(id,email,password_hash,role,cabinet_ids,is_active)
  values
    ('91000000-0000-4000-8000-000000000001','payout-finance@test.invalid','x','finance',
      array['92000000-0000-4000-8000-000000000001']::uuid[],true),
    ('91000000-0000-4000-8000-000000000002','payout-director@test.invalid','x','director',
      array[]::uuid[],true),
    ('91000000-0000-4000-8000-000000000003','payout-director-2@test.invalid','x','director',
      array[]::uuid[],true);
  insert into public.wb_cabinets(id,name,token,is_active,marketplace)
  values
    ('92000000-0000-4000-8000-000000000001','Payout fixture WB','fixture-value',true,'wb'),
    ('92000000-0000-4000-8000-000000000002','Payout fixture WB 2','fixture-value',true,'wb');
  insert into public.companies(id,name,group_name,is_active) values
    ('93000000-0000-4000-8000-000000000001','Synthetic account owner','Payout fixture',true),
    ('93000000-0000-4000-8000-000000000002','Synthetic seller company','Payout fixture',true);
  insert into public.accounts(id,name,type,currency,balance,company_id) values
    ('94000000-0000-4000-8000-000000000001','Synthetic shared account','bank','RUB',0,
      '93000000-0000-4000-8000-000000000001'),
    ('94000000-0000-4000-8000-000000000002','Synthetic historical account','bank','RUB',0,
      '93000000-0000-4000-8000-000000000001');
  insert into public.marketplace_payout_routes(
    id,marketplace,cabinet_id,company_id,receiving_account_id,payer_inn,payer_kpp,
    payer_legal_name,account_kind,require_exact_payer_inn,valid_from,created_by)
  values('97000000-0000-4000-8000-000000000001','wb',
    '92000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000002',
    '94000000-0000-4000-8000-000000000001',
    '9714053621','507401001','ООО «РВБ»','shared',true,'2026-01-01T00:00:00Z',
    '91000000-0000-4000-8000-000000000002');
end
$$;

revoke all on all functions in schema test_support from public, payout_rpc_executor;
revoke all on all tables in schema test_support from public, payout_rpc_executor;
