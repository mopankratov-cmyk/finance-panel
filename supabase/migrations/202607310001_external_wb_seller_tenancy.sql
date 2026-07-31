-- Tenant-контур для внешних WB-селлеров.
-- Приложение авторизует пользователей собственной httpOnly-сессией и читает
-- эти таблицы только через service_role. Публичным Supabase-ролям доступ не нужен.

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 160),
  kind text not null default 'seller' check (kind in ('internal', 'seller')),
  created_at timestamptz not null default now()
);

alter table public.app_users
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict;

alter table public.wb_cabinets
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict;

do $$
declare
  internal_organization_id uuid;
begin
  select id into internal_organization_id
  from public.organizations
  where kind = 'internal'
  order by created_at
  limit 1;

  if internal_organization_id is null then
    insert into public.organizations (name, kind)
    values ('Finance Panel', 'internal')
    returning id into internal_organization_id;
  end if;

  update public.app_users
  set organization_id = internal_organization_id
  where organization_id is null;

  update public.wb_cabinets
  set organization_id = internal_organization_id
  where organization_id is null;
end $$;

alter table public.app_users
  alter column organization_id set not null;

alter table public.wb_cabinets
  alter column organization_id set not null;

create index if not exists app_users_organization_idx
  on public.app_users (organization_id);

create index if not exists wb_cabinets_organization_marketplace_idx
  on public.wb_cabinets (organization_id, marketplace, is_active);

-- seller_id может повторяться у виртуальных кабинетов одной организации, но
-- не может принадлежать двум разным tenant. Отдельный claim даёт атомарный
-- барьер от гонки двух одновременных подключений.
create table if not exists public.marketplace_tenant_claims (
  marketplace text not null check (marketplace in ('wb', 'ozon')),
  seller_id text not null check (char_length(trim(seller_id)) > 0),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (marketplace, seller_id)
);

do $$
begin
  if exists (
    select 1
    from public.wb_cabinets
    where marketplace in ('wb', 'ozon')
      and seller_id is not null
      and char_length(trim(seller_id)) > 0
    group by marketplace, seller_id
    having count(distinct organization_id) > 1
  ) then
    raise exception 'Один marketplace seller_id уже принадлежит нескольким организациям';
  end if;
end $$;

insert into public.marketplace_tenant_claims (marketplace, seller_id, organization_id)
select distinct on (marketplace, seller_id)
  marketplace, seller_id, organization_id
from public.wb_cabinets
where marketplace in ('wb', 'ozon')
  and seller_id is not null
  and char_length(trim(seller_id)) > 0
order by marketplace, seller_id, created_at
on conflict (marketplace, seller_id) do nothing;

alter table public.organizations enable row level security;
alter table public.marketplace_tenant_claims enable row level security;

-- Удаляем историческую permissive policy с app_users: она раскрывала хэши
-- паролей через публичный anon key. Сервер использует service_role и не зависит
-- от этой policy.
do $$
declare p record;
begin
  for p in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public' and tablename in ('organizations', 'app_users')
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

revoke all on table public.organizations from anon, authenticated;
revoke all on table public.app_users from anon, authenticated;
revoke all on table public.marketplace_tenant_claims from anon, authenticated;
grant all on table public.organizations to service_role;
grant all on table public.app_users to service_role;
grant all on table public.marketplace_tenant_claims to service_role;

comment on column public.app_users.organization_id is
  'Tenant пользователя. Внешний seller видит только кабинеты этой организации и только из cabinet_ids.';

comment on column public.wb_cabinets.organization_id is
  'Владелец кабинета; запрещает подключение одного seller_id к разным tenant.';
