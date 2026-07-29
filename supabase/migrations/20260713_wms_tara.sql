-- P1.2: кабинетные credentials МойСклад, активная готовая тара и безопасные WMS-запуски.
-- Токены доступны только service_role. Старые глобальные строки остаются отключённым
-- legacy-следом и не подхватываются ни одним кабинетным API.

alter table public.moysklad_connection
  add column if not exists cabinet_id uuid references public.wb_cabinets(id) on delete cascade,
  add column if not exists organization_href text,
  add column if not exists organization_name text,
  add column if not exists store_href text,
  add column if not exists store_name text,
  add column if not exists connected_by text;

drop policy if exists "all" on public.moysklad_connection;
revoke all on table public.moysklad_connection from anon, authenticated;
create unique index if not exists moysklad_connection_cabinet_unique
  on public.moysklad_connection(cabinet_id) where cabinet_id is not null;

-- Optima остаётся закрытым контуром даже если кабинет был создан до появления
-- brand_filters и ещё не пересохранялся через UI.
update public.wb_cabinets
set brand_filters = array['norvia', 'riobox']::text[]
where marketplace = 'wb'
  and (
    lower(coalesce(name, '') || ' ' || coalesce(trade_mark, '')) like '%optima%'
    or lower(coalesce(name, '') || ' ' || coalesce(trade_mark, '')) like '%оптима%'
  )
  and brand_filters is distinct from array['norvia', 'riobox']::text[];

create table if not exists public.wms_tara_imports (
  id          uuid primary key default gen_random_uuid(),
  cabinet_id  uuid not null references public.wb_cabinets(id) on delete cascade,
  file_name   text not null,
  file_hash   text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  status      text not null default 'active' check (status in ('active', 'superseded')),
  columns     jsonb not null default '{}'::jsonb,
  summary     jsonb not null default '{}'::jsonb,
  imported_by text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique(cabinet_id, file_hash)
);

create unique index if not exists wms_tara_one_active_per_cabinet
  on public.wms_tara_imports(cabinet_id) where status = 'active';

create table if not exists public.wms_tara_lines (
  id            bigint generated always as identity primary key,
  import_id     uuid not null references public.wms_tara_imports(id) on delete cascade,
  line_number   integer not null,
  container     text not null,
  nm_id         bigint,
  article       text not null default '',
  barcode       text not null default '',
  quantity      numeric(14, 3) not null check (quantity > 0),
  volume_liters numeric(14, 3),
  unique(import_id, line_number, container, article, barcode)
);

create index if not exists wms_tara_lines_import_idx on public.wms_tara_lines(import_id);
create index if not exists wms_tara_lines_nm_idx on public.wms_tara_lines(nm_id);

create table if not exists public.wms_order_runs (
  id                uuid primary key default gen_random_uuid(),
  cabinet_id        uuid not null references public.wb_cabinets(id) on delete cascade,
  import_id         uuid not null references public.wms_tara_imports(id),
  status            text not null default 'dry_run' check (status in ('dry_run', 'creating', 'created', 'failed')),
  settings_snapshot jsonb not null,
  plan_json         jsonb not null,
  external_orders   jsonb not null default '[]'::jsonb,
  error             text,
  created_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists wms_order_runs_cabinet_created_idx on public.wms_order_runs(cabinet_id, created_at desc);

alter table public.wms_tara_imports enable row level security;
alter table public.wms_tara_lines enable row level security;
alter table public.wms_order_runs enable row level security;
revoke all on table public.wms_tara_imports, public.wms_tara_lines, public.wms_order_runs from anon, authenticated;

create or replace function public.save_wms_tara_import(p_import jsonb, p_actor text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cabinet_id uuid := nullif(p_import->>'cabinetId', '')::uuid;
  v_lines jsonb := coalesce(p_import->'lines', '[]'::jsonb);
  v_import_id uuid;
  v_scoped boolean := false;
  v_before jsonb;
  v_after jsonb;
begin
  if v_cabinet_id is null then raise exception 'cabinetId is required'; end if;
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 or jsonb_array_length(v_lines) > 20000 then
    raise exception 'lines must contain 1..20000 rows';
  end if;
  if coalesce(p_import->>'fileHash', '') !~ '^[0-9a-f]{64}$' then raise exception 'invalid file hash'; end if;

  select cardinality(coalesce(brand_filters, '{}'::text[])) > 0 into v_scoped
  from public.wb_cabinets where id = v_cabinet_id and marketplace = 'wb';
  if not found then raise exception 'cabinet not found'; end if;
  if v_scoped and exists (
    select 1 from jsonb_array_elements(v_lines) line
    where nullif(line->>'nmId', '') is null
       or not exists (
         select 1 from public.wb_cabinet_product_scope scope
         where scope.cabinet_id = v_cabinet_id and scope.nm_id = (line->>'nmId')::bigint
       )
  ) then raise exception 'tara contains products outside cabinet scope'; end if;

  select to_jsonb(active_import) into v_before
  from public.wms_tara_imports active_import
  where active_import.cabinet_id = v_cabinet_id and active_import.status = 'active';

  update public.wms_tara_imports set status = 'superseded', updated_at = now()
  where cabinet_id = v_cabinet_id and status = 'active';

  insert into public.wms_tara_imports(cabinet_id, file_name, file_hash, status, columns, summary, imported_by)
  values (
    v_cabinet_id,
    left(coalesce(nullif(p_import->>'fileName', ''), 'containerscontent.xlsx'), 255),
    p_import->>'fileHash',
    'active',
    coalesce(p_import->'columns', '{}'::jsonb),
    coalesce(p_import->'summary', '{}'::jsonb),
    p_actor
  )
  on conflict(cabinet_id, file_hash) do update set
    file_name = excluded.file_name,
    status = 'active',
    columns = excluded.columns,
    summary = excluded.summary,
    imported_by = excluded.imported_by,
    updated_at = now()
  returning id into v_import_id;

  delete from public.wms_tara_lines where import_id = v_import_id;
  insert into public.wms_tara_lines(import_id, line_number, container, nm_id, article, barcode, quantity, volume_liters)
  select
    v_import_id,
    coalesce((line->>'lineNumber')::integer, ordinal::integer),
    left(trim(line->>'container'), 120),
    nullif(line->>'nmId', '')::bigint,
    left(coalesce(line->>'article', ''), 255),
    left(coalesce(line->>'barcode', ''), 120),
    (line->>'quantity')::numeric,
    nullif(line->>'volumeLiters', '')::numeric
  from jsonb_array_elements(v_lines) with ordinality as source(line, ordinal);

  select to_jsonb(saved) into v_after from public.wms_tara_imports saved where saved.id = v_import_id;
  insert into public.operation_audit_log(cabinet_id, entity_type, entity_id, action, actor, before_data, after_data)
  values (v_cabinet_id, 'wms_tara_import', v_import_id, 'activated', p_actor, v_before, v_after);
  return v_after;
end;
$$;

revoke all on function public.save_wms_tara_import(jsonb, text) from public;
grant execute on function public.save_wms_tara_import(jsonb, text) to service_role;
