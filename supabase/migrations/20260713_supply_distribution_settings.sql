-- P1.1: сохранённый кабинетный сценарий распределения поставки.
-- Не создаёт поставки WB и не трогает остатки: это управляемый план + экспорт.

create table if not exists public.supply_distribution_settings (
  cabinet_id       uuid primary key references public.wb_cabinets(id) on delete cascade,
  warehouse_shares jsonb not null default '[]'::jsonb,
  excluded_nm_ids  bigint[] not null default '{}',
  min_batch        integer not null default 30 check (min_batch >= 0 and min_batch <= 1000000),
  pallet_liters    numeric(12, 2) not null default 1230 check (pallet_liters >= 0 and pallet_liters <= 100000),
  updated_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.supply_distribution_settings enable row level security;
revoke all on table public.supply_distribution_settings from anon, authenticated;

create or replace function public.save_supply_distribution_settings(p_settings jsonb, p_actor text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cabinet_id uuid;
  v_shares jsonb;
  v_excluded bigint[];
  v_total numeric;
  v_before jsonb;
  v_after jsonb;
begin
  v_cabinet_id := nullif(p_settings->>'cabinetId', '')::uuid;
  v_shares := coalesce(p_settings->'warehouses', '[]'::jsonb);
  if v_cabinet_id is null then raise exception 'cabinetId is required'; end if;
  if jsonb_typeof(v_shares) <> 'array' or jsonb_array_length(v_shares) = 0 or jsonb_array_length(v_shares) > 30 then
    raise exception 'warehouses must contain 1..30 rows';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_shares) share
    where trim(coalesce(share->>'name', '')) = ''
       or coalesce((share->>'pct')::numeric, -1) < 0
       or coalesce((share->>'pct')::numeric, 101) > 100
  ) then raise exception 'invalid warehouse share'; end if;
  select coalesce(sum((share->>'pct')::numeric), 0) into v_total from jsonb_array_elements(v_shares) share;
  if abs(v_total - 100) > 0.01 then raise exception 'warehouse shares must total 100'; end if;

  select coalesce(array_agg(distinct excluded_nm.value::bigint), '{}'::bigint[])
  into v_excluded
  from jsonb_array_elements_text(coalesce(p_settings->'excludedNmIds', '[]'::jsonb)) as excluded_nm(value);

  select to_jsonb(settings) into v_before
  from public.supply_distribution_settings settings
  where settings.cabinet_id = v_cabinet_id;

  insert into public.supply_distribution_settings (
    cabinet_id, warehouse_shares, excluded_nm_ids, min_batch, pallet_liters, updated_by
  ) values (
    v_cabinet_id,
    v_shares,
    v_excluded,
    greatest(0, least(1000000, coalesce((p_settings->>'minBatch')::integer, 30))),
    greatest(0, least(100000, coalesce((p_settings->>'palletLiters')::numeric, 1230))),
    p_actor
  )
  on conflict (cabinet_id) do update set
    warehouse_shares = excluded.warehouse_shares,
    excluded_nm_ids = excluded.excluded_nm_ids,
    min_batch = excluded.min_batch,
    pallet_liters = excluded.pallet_liters,
    updated_by = excluded.updated_by,
    updated_at = now();

  select to_jsonb(settings) into v_after
  from public.supply_distribution_settings settings
  where settings.cabinet_id = v_cabinet_id;

  insert into public.operation_audit_log (
    cabinet_id, entity_type, entity_id, action, actor, before_data, after_data
  ) values (
    v_cabinet_id,
    'supply_distribution',
    v_cabinet_id,
    case when v_before is null then 'created' else 'updated' end,
    p_actor,
    v_before,
    v_after
  );

  return v_after;
end;
$$;

revoke all on function public.save_supply_distribution_settings(jsonb, text) from public;
grant execute on function public.save_supply_distribution_settings(jsonb, text) to service_role;
