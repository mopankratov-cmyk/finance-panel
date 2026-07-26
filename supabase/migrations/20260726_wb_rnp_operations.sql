-- Управленческий слой РНП: общие теги SKU и журнал изменений.
-- Таблицы закрыты от клиентских ролей; доступ только через серверные API с
-- проверкой сессии, кабинета и allowlist.

create table if not exists public.wb_rnp_tags (
  id          uuid primary key default gen_random_uuid(),
  cabinet_id  uuid not null references public.wb_cabinets(id) on delete cascade,
  name        text not null check (char_length(trim(name)) between 1 and 40),
  color       text not null default '#7c3aed' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.wb_rnp_tags
  add constraint wb_rnp_tags_cabinet_id_id_key unique (cabinet_id, id);

create unique index if not exists wb_rnp_tags_cabinet_name_uidx
  on public.wb_rnp_tags (cabinet_id, lower(trim(name)));

create table if not exists public.wb_rnp_sku_tags (
  cabinet_id  uuid not null references public.wb_cabinets(id) on delete cascade,
  nm_id       bigint not null check (nm_id > 0),
  tag_id      uuid not null,
  assigned_by text,
  created_at  timestamptz not null default now(),
  primary key (cabinet_id, nm_id, tag_id),
  foreign key (cabinet_id, tag_id)
    references public.wb_rnp_tags(cabinet_id, id)
    on delete cascade
);

create index if not exists wb_rnp_sku_tags_lookup_idx
  on public.wb_rnp_sku_tags (cabinet_id, nm_id);

create table if not exists public.wb_rnp_journal (
  id          uuid primary key default gen_random_uuid(),
  cabinet_id  uuid not null references public.wb_cabinets(id) on delete cascade,
  nm_id       bigint not null check (nm_id > 0),
  event_date  date not null default current_date,
  event_type  text not null check (event_type in (
    'note',
    'price_up',
    'price_down',
    'discount_up',
    'discount_down',
    'promotion_in',
    'promotion_out',
    'ad_budget_up',
    'ad_budget_down',
    'ad_on',
    'ad_off',
    'ab_start',
    'ab_finish',
    'photo',
    'seo',
    'supply',
    'reviews'
  )),
  comment     text not null default '' check (char_length(comment) <= 2000),
  created_by  text,
  created_at  timestamptz not null default now()
);

create index if not exists wb_rnp_journal_product_date_idx
  on public.wb_rnp_journal (cabinet_id, nm_id, event_date desc, created_at desc);

alter table public.wb_rnp_tags enable row level security;
alter table public.wb_rnp_sku_tags enable row level security;
alter table public.wb_rnp_journal enable row level security;

revoke all on table public.wb_rnp_tags from anon, authenticated;
revoke all on table public.wb_rnp_sku_tags from anon, authenticated;
revoke all on table public.wb_rnp_journal from anon, authenticated;

grant all on table public.wb_rnp_tags to service_role;
grant all on table public.wb_rnp_sku_tags to service_role;
grant all on table public.wb_rnp_journal to service_role;
