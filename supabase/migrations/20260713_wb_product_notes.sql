-- P1.4 / P9: кабинетные статусы готовности, комментарии и Drive-папки SKU.
-- Данные доступны только service_role; Optima дополнительно закрыта allowlist
-- NORVIA/RIOBOX внутри security definer функции.

create table if not exists public.wb_product_notes (
  id          uuid primary key default gen_random_uuid(),
  cabinet_id  uuid not null references public.wb_cabinets(id) on delete cascade,
  nm_id       bigint not null check (nm_id > 0),
  article     text not null default '',
  status      text not null default 'pending' check (status in ('pending', 'in_progress', 'ready', 'blocked')),
  comment     text not null default '',
  drive_url   text,
  updated_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique(cabinet_id, nm_id)
);

create index if not exists wb_product_notes_cabinet_status_idx
  on public.wb_product_notes(cabinet_id, status, updated_at desc);

alter table public.wb_product_notes enable row level security;
revoke all on table public.wb_product_notes from anon, authenticated;
grant all on table public.wb_product_notes to service_role;

create or replace function public.save_wb_product_note(p_note jsonb, p_actor text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cabinet_id uuid := nullif(p_note->>'cabinetId', '')::uuid;
  v_nm_id bigint := nullif(p_note->>'nmId', '')::bigint;
  v_status text := coalesce(nullif(p_note->>'status', ''), 'pending');
  v_brand text := lower(regexp_replace(coalesce(p_note->>'brand', ''), '[^a-zа-яё0-9]+', '', 'gi'));
  v_brand_filters text[] := '{}'::text[];
  v_note_id uuid;
  v_scoped boolean := false;
  v_before jsonb;
  v_after jsonb;
begin
  if v_cabinet_id is null or v_nm_id is null or v_nm_id <= 0 then raise exception 'cabinetId and nmId are required'; end if;
  if v_status not in ('pending', 'in_progress', 'ready', 'blocked') then raise exception 'invalid readiness status'; end if;
  if length(coalesce(p_note->>'comment', '')) > 4000 then raise exception 'comment is too long'; end if;
  if length(coalesce(p_note->>'driveUrl', '')) > 2048 then raise exception 'drive url is too long'; end if;

  select coalesce(brand_filters, '{}'::text[]), cardinality(coalesce(brand_filters, '{}'::text[])) > 0
  into v_brand_filters, v_scoped
  from public.wb_cabinets where id = v_cabinet_id and marketplace = 'wb';
  if not found then raise exception 'cabinet not found'; end if;
  if v_scoped and (
    not exists (
      select 1 from unnest(v_brand_filters) filter_brand
      where lower(regexp_replace(filter_brand, '[^a-zа-яё0-9]+', '', 'gi')) = v_brand
    ) or not exists (
      select 1 from public.wb_cabinet_product_scope
      where cabinet_id = v_cabinet_id and nm_id = v_nm_id
    )
  ) then raise exception 'product is outside cabinet scope'; end if;

  select note.id, to_jsonb(note) into v_note_id, v_before
  from public.wb_product_notes note
  where note.cabinet_id = v_cabinet_id and note.nm_id = v_nm_id;

  insert into public.wb_product_notes(cabinet_id, nm_id, article, status, comment, drive_url, updated_by)
  values (
    v_cabinet_id,
    v_nm_id,
    left(coalesce(p_note->>'article', ''), 255),
    v_status,
    left(coalesce(p_note->>'comment', ''), 4000),
    nullif(left(coalesce(p_note->>'driveUrl', ''), 2048), ''),
    p_actor
  )
  on conflict(cabinet_id, nm_id) do update set
    article = excluded.article,
    status = excluded.status,
    comment = excluded.comment,
    drive_url = excluded.drive_url,
    updated_by = excluded.updated_by,
    updated_at = now()
  returning id into v_note_id;

  select to_jsonb(note) into v_after from public.wb_product_notes note where note.id = v_note_id;
  insert into public.operation_audit_log(cabinet_id, entity_type, entity_id, action, actor, before_data, after_data)
  values (v_cabinet_id, 'wb_product_note', v_note_id, case when v_before is null then 'created' else 'updated' end, p_actor, v_before, v_after);
  return v_after;
end;
$$;

revoke all on function public.save_wb_product_note(jsonb, text) from public;
grant execute on function public.save_wb_product_note(jsonb, text) to service_role;
