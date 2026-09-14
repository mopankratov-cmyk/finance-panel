-- Частичные отгрузки (§9 ТЗ, пайплайн 2.1): один заказ — много отгрузок.
-- Сегодня у заказа ровно одна приёмка (purchase_orders.receipt_batch_id,
-- create_purchase_order_receipt) — это НЕ трогаем: отгрузки здесь чисто
-- логистическая видимость (кто везёт, каким маршрутом, где сейчас), а не
-- замена приёмки. Свести отгрузки с фактической приёмкой/остатком —
-- отдельная, более рискованная задача фазы 3, тут её нет.

create table if not exists public.supplier_shipments (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.purchase_orders(id) on delete cascade,
  carrier      text not null default '',
  route        text not null default '',
  status       text not null default 'planned' check (status in ('planned', 'shipped', 'customs', 'arrived', 'received', 'cancelled')),
  eta          date,
  shipped_at   timestamptz,
  arrived_at   timestamptz,
  received_at  timestamptz,
  note         text,
  created_by   text,
  updated_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists supplier_shipments_order_idx on public.supplier_shipments (order_id, created_at);
create index if not exists supplier_shipments_active_idx on public.supplier_shipments (status) where status not in ('received', 'cancelled');

create table if not exists public.supplier_shipment_items (
  id           bigint generated always as identity primary key,
  shipment_id  uuid not null references public.supplier_shipments(id) on delete cascade,
  nm_id        bigint not null,
  article      text not null default '',
  quantity     integer not null check (quantity > 0)
);

create index if not exists supplier_shipment_items_shipment_idx on public.supplier_shipment_items (shipment_id);

alter table public.supplier_shipments enable row level security;
alter table public.supplier_shipment_items enable row level security;
revoke all on public.supplier_shipments from anon, authenticated;
revoke all on public.supplier_shipment_items from anon, authenticated;
notify pgrst, 'reload schema';
