-- §27.12 ТЗ: партия должна быть связана с заказом, поставщиком, страной и
-- юрлицом. legal_entity_id и order_id уже есть — supplier_id и country нет.
--
-- Снимок на момент проводки, а не живой JOIN: карточку поставщика могут
-- поправить позже (сменить страну), а уже проведённая партия задним числом
-- меняться не должна — тот же принцип, что уже применён к cost_basis.

alter table public.stock_batches
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null,
  add column if not exists country     text;

create index if not exists stock_batches_supplier_idx
  on public.stock_batches (supplier_id);

comment on column public.stock_batches.supplier_id is
  'Ссылка на suppliers на момент проводки партии. NULL — партия без привязанного
   поставщика: приёмка без заказа фабрике, либо заказ создан без выбора
   supplier_id в форме (только текстовое поле supplier).';
comment on column public.stock_batches.country is
  'Снимок suppliers.country на момент проводки, не живой JOIN — карточку
   поставщика могут поправить позже, партия задним числом не меняется.';

-- Backfill только для уже привязанных заказов — тем же путём, каким это
-- сделает и сам RPC для новых партий. Никакого текстового сопоставления
-- purchase_orders.supplier ↔ suppliers.name: ровно этого миграция
-- 202609140003_suppliers.sql сознательно избегала.
update public.stock_batches b
set supplier_id = po.supplier_id,
    country = s.country
from public.purchase_orders po
left join public.suppliers s on s.id = po.supplier_id
where b.order_id = po.id
  and po.supplier_id is not null
  and b.supplier_id is null;
