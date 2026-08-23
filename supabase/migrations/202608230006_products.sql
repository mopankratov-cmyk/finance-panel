-- Свой справочник товаров: артикул рождается у нас, а не в маркетплейсе.
--
-- До сих пор номенклатура существовала как отражение WB: `wb_cards` — зеркало карточек
-- по nm_id, а регистр движений требовал nm_id обязательным. Новый артикул завести было
-- негде, и товар, приехавший с фабрики до создания карточки, учесть было нечем.
--
-- Теперь ключ — наш артикул. Связь с карточкой маркетплейса (`nm_id`) необязательна
-- и проставляется, когда карточка появится: история остатков от этого не меняется.
--
-- `product_costs` остаётся на месте — им пользуются ОПиУ, РНП и юнит-экономика, и трогать
-- его в рамках склада нельзя. Товары наполняются из него один раз, дальше живут своей
-- жизнью; себестоимость в справочнике товаров не дублируется, она считается регистром.

create table if not exists public.products (
  id               uuid primary key default gen_random_uuid(),
  legal_entity_id  uuid references public.legal_entities(id) on delete restrict,
  article          text not null,
  name             text not null default '',
  barcode          text,
  category         text,
  brand            text,
  nm_id            bigint,
  -- Данные закупки: без цены фабрики и габаритов не посчитать ни логистику,
  -- ни потребность — поэтому им место в карточке товара, а не в заказе.
  factory_price    numeric(14, 2) check (factory_price is null or factory_price >= 0),
  factory_currency text not null default 'CNY' check (factory_currency in ('CNY', 'RUB', 'USD')),
  weight_kg        numeric(10, 3) check (weight_kg is null or weight_kg >= 0),
  length_cm        numeric(10, 1) check (length_cm is null or length_cm >= 0),
  width_cm         numeric(10, 1) check (width_cm is null or width_cm >= 0),
  height_cm        numeric(10, 1) check (height_cm is null or height_cm >= 0),
  min_stock        integer check (min_stock is null or min_stock >= 0),
  -- Сезонный товар планируется только в свои месяцы; вне сезона он не просит заказа.
  season           text check (season is null or season in ('summer', 'winter')),
  is_active        boolean not null default true,
  note             text,
  created_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists products_article_unique on public.products (lower(article));
create index if not exists products_nm_idx on public.products (nm_id) where nm_id is not null;
create index if not exists products_entity_idx on public.products (legal_entity_id, is_active);
create index if not exists products_category_idx on public.products (category);

-- Объём считается из габаритов: хранить его отдельно значило бы дать ему разойтись.
create or replace view public.products_view as
select
  p.*,
  case
    when p.length_cm is not null and p.width_cm is not null and p.height_cm is not null
      then round((p.length_cm * p.width_cm * p.height_cm) / 1000.0, 3)
    else null
  end as volume_liters
from public.products p;

-- ---------------------------------------------------------------------------
-- Наполнение из существующей номенклатуры
-- ---------------------------------------------------------------------------
-- Юрлицо подтягивается по названию из `product_costs.entity` («ИП ПАНКРАТОВ» и т.п.).
-- Если совпадения нет — товар заводится без юрлица: пустое поле честнее выдуманного.

insert into public.products (legal_entity_id, article, name, barcode, category, brand, created_by)
select
  entity_match.id,
  costs.article,
  coalesce(nullif(costs.name, ''), costs.article),
  nullif(costs.wb_barcode, ''),
  costs.category,
  nullif(costs.brand, ''),
  'миграция из product_costs'
from public.product_costs costs
left join public.legal_entities entity_match
  on lower(entity_match.name) = lower(coalesce(costs.entity, ''))
where costs.article is not null and costs.article <> ''
on conflict do nothing;

-- Карточки WB подцепляются по артикулу — там, где артикул совпал ровно с одним nm_id.
update public.products p
set nm_id = matched.nm_id
from (
  select lower(article) as article_key, min(nm_id) as nm_id
  from public.wb_cards
  where article is not null and article <> ''
  group by lower(article)
  having count(distinct nm_id) = 1
) matched
where lower(p.article) = matched.article_key and p.nm_id is null;

-- ---------------------------------------------------------------------------
-- Регистр учится жить без nm_id
-- ---------------------------------------------------------------------------

alter table public.stock_moves
  add column if not exists product_id uuid references public.products(id) on delete restrict;

update public.stock_moves m
set product_id = p.id
from public.products p
where m.product_id is null and p.nm_id is not null and p.nm_id = m.nm_id;

alter table public.stock_moves alter column nm_id drop not null;

create index if not exists stock_moves_product_idx on public.stock_moves (legal_entity_id, warehouse_id, product_id);

-- Приёмка заводится по товару: у новинки, приехавшей до создания карточки на WB,
-- nm_id ещё нет, а принять её надо.
alter table public.purchase_receipts
  add column if not exists product_id uuid references public.products(id) on delete restrict;

update public.purchase_receipts r
set product_id = p.id
from public.products p
where r.product_id is null and p.nm_id is not null and p.nm_id = r.nm_id;

alter table public.purchase_receipts alter column nm_id drop not null;

create index if not exists purchase_receipts_product_idx on public.purchase_receipts (product_id);

-- Остаток теперь считается по товару. nm_id и артикул остаются в выдаче, чтобы
-- экраны маркетплейса могли сопоставиться с карточкой.
drop view if exists public.stock_balances;

create view public.stock_balances as
select
  m.legal_entity_id,
  m.warehouse_id,
  m.product_id,
  max(p.article) as article,
  max(p.name) as name,
  max(p.nm_id) as nm_id,
  sum(m.qty)::integer as qty,
  sum(m.amount)::numeric(14, 2) as amount,
  case when sum(m.qty) > 0 then round(sum(m.amount) / sum(m.qty), 2) else 0 end as unit_cost,
  max(m.occurred_at) as last_move_at
from public.stock_moves m
join public.products p on p.id = m.product_id
group by m.legal_entity_id, m.warehouse_id, m.product_id;

revoke all on public.stock_balances from anon, authenticated;
revoke all on public.products_view from anon, authenticated;

alter table public.products enable row level security;
drop policy if exists "all" on public.products;
create policy "all" on public.products for all using (true) with check (true);
revoke all on table public.products from anon, authenticated;

notify pgrst, 'reload schema';
