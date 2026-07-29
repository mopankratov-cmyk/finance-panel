-- Товарный scope кабинета: если brand_filters непустой, в аналитику допускаются
-- только nm_id из wb_cabinet_product_scope. Сами токены остаются только для
-- server-side service_role: anon/authenticated не должны читать wb_cabinets.

alter table public.wb_cabinets
  add column if not exists brand_filters text[] not null default '{}';

create table if not exists public.wb_cabinet_product_scope (
  cabinet_id uuid not null references public.wb_cabinets(id) on delete cascade,
  nm_id bigint not null,
  article text,
  brand text,
  created_at timestamptz not null default now(),
  primary key (cabinet_id, nm_id)
);

create index if not exists wb_cabinet_product_scope_nm_idx
  on public.wb_cabinet_product_scope (nm_id);

alter table public.wb_cabinet_product_scope enable row level security;

-- В старой миграции была policy "all", из-за которой публичный anon key мог
-- читать сырые WB/Ozon-токены напрямую через PostgREST. Удаляем все политики
-- только с таблицы секретов; приложение обращается к ней через service_role.
do $$
declare p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'wb_cabinets'
  loop
    execute format('drop policy if exists %I on public.wb_cabinets', p.policyname);
  end loop;
end $$;

revoke all on table public.wb_cabinets from anon, authenticated;
revoke all on table public.wb_cabinet_product_scope from anon, authenticated;
grant all on table public.wb_cabinets to service_role;
grant all on table public.wb_cabinet_product_scope to service_role;

comment on column public.wb_cabinets.brand_filters is
  'Пусто = весь кабинет; непусто = только SKU из wb_cabinet_product_scope';
