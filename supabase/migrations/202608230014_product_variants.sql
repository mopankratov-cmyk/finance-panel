-- Варианты товара: модель и размер.
--
-- Товар был плоским, а ассортимент — нет. Одежда живёт размерами: у WB каждый
-- размер несёт свой баркод, GTIN Честного Знака выдаётся тоже на размер, а
-- сборочное задание ФБС приходит с баркодом. «NV-836-02 — 40 штук» не отвечает
-- на вопрос, есть ли L.
--
-- Модель остаётся тем, что уже есть в products: фото, категория, себестоимость,
-- вес, габариты, карточка WB. Вариант несёт то, что различается по размеру:
-- ярлык, баркод, chrt_id характеристики WB.
--
-- Ось ровно одна — размер. Цвет уже зашит в артикул модели (NV-836-<b>02</b>),
-- и универсальный конструктор осей, как «характеристики» МойСклада, здесь дал бы
-- сложность без пользы. Схема второй оси не запрещает, если она понадобится.
--
-- Безразмерный товар — крем, сумка, пенал — получает один вариант «базовый».
-- Он скрыт в интерфейсе: пока размеры не заведены, экраны выглядят как раньше.

create table if not exists public.product_variants (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products(id) on delete cascade,
  size_label   text not null default '',
  barcode      text,
  chrt_id      bigint,
  is_default   boolean not null default false,
  position     integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists product_variants_size_unique
  on public.product_variants (product_id, lower(size_label));
create unique index if not exists product_variants_barcode_unique
  on public.product_variants (barcode) where barcode is not null;
-- Базовый вариант у модели ровно один: он представляет её там, где размер не указан.
create unique index if not exists product_variants_default_unique
  on public.product_variants (product_id) where is_default;
create index if not exists product_variants_product_idx
  on public.product_variants (product_id, position);
create index if not exists product_variants_chrt_idx
  on public.product_variants (chrt_id) where chrt_id is not null;

-- ---------------------------------------------------------------------------
-- Базовый вариант каждому существующему товару
-- ---------------------------------------------------------------------------

insert into public.product_variants (product_id, size_label, barcode, is_default)
select p.id, '', nullif(p.barcode, ''), true
from public.products p
where not exists (select 1 from public.product_variants v where v.product_id = p.id)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Регистр и приёмка переезжают на вариант
-- ---------------------------------------------------------------------------

alter table public.stock_moves
  add column if not exists variant_id uuid references public.product_variants(id) on delete restrict;
alter table public.purchase_receipts
  add column if not exists variant_id uuid references public.product_variants(id) on delete restrict;

-- Вся прошлая история — про модель без размера, значит про её базовый вариант.
-- Триггер append-only снимаем на время: он стережёт количество и сумму, а здесь
-- проставляется ссылка, которой раньше просто не существовало. Остаток не меняется.
alter table public.stock_moves disable trigger stock_moves_append_only_trigger;

update public.stock_moves m
set variant_id = v.id
from public.product_variants v
where m.variant_id is null and v.product_id = m.product_id and v.is_default;

alter table public.stock_moves enable trigger stock_moves_append_only_trigger;

update public.purchase_receipts r
set variant_id = v.id
from public.product_variants v
where r.variant_id is null and v.product_id = r.product_id and v.is_default;

do $variant_check$
begin
  if exists (select 1 from public.stock_moves where variant_id is null) then
    raise exception 'есть движения без варианта — базовые варианты созданы не для всех товаров';
  end if;
end $variant_check$;

alter table public.stock_moves alter column variant_id set not null;

create index if not exists stock_moves_variant_idx
  on public.stock_moves (legal_entity_id, warehouse_id, variant_id);

-- ---------------------------------------------------------------------------
-- Остаток считается по варианту
-- ---------------------------------------------------------------------------
-- Строка остатка — это «модель + размер». У безразмерного товара размер пустой,
-- и строка выглядит ровно как раньше.

drop view if exists public.stock_balances;

create view public.stock_balances as
select
  m.legal_entity_id,
  m.warehouse_id,
  m.variant_id,
  m.product_id,
  max(p.article) as article,
  max(p.name) as name,
  max(p.nm_id) as nm_id,
  max(p.photo_url) as photo_url,
  max(v.size_label) as size_label,
  max(v.barcode) as barcode,
  sum(m.qty)::integer as qty,
  sum(m.amount)::numeric(14, 2) as amount,
  case when sum(m.qty) > 0 then round(sum(m.amount) / sum(m.qty), 2) else 0 end as unit_cost,
  max(m.occurred_at) as last_move_at
from public.stock_moves m
join public.product_variants v on v.id = m.variant_id
join public.products p on p.id = m.product_id
group by m.legal_entity_id, m.warehouse_id, m.variant_id, m.product_id;

revoke all on public.stock_balances from anon, authenticated;

-- Список вариантов с артикулом модели — для выпадающих списков и импорта.
create or replace view public.product_variants_view as
select
  v.id,
  v.product_id,
  v.size_label,
  v.barcode,
  v.chrt_id,
  v.is_default,
  v.position,
  v.is_active,
  p.article,
  p.name,
  p.nm_id,
  p.photo_url,
  p.legal_entity_id
from public.product_variants v
join public.products p on p.id = v.product_id;

revoke all on public.product_variants_view from anon, authenticated;

alter table public.product_variants enable row level security;
drop policy if exists "all" on public.product_variants;
create policy "all" on public.product_variants for all using (true) with check (true);
revoke all on table public.product_variants from anon, authenticated;

notify pgrst, 'reload schema';
