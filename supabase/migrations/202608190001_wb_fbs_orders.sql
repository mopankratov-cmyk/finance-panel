-- FBS-заказы из Marketplace API (см. app/api/sync/fbs-orders/route.ts).
-- Единственный достоверный признак схемы продажи: warehouseType в статистике
-- метит «Складом продавца» и FBO-отгрузки из транзитных СЦ (сверка с кабинетом
-- 2026-08-17), поэтому сплит ФБО/ФБС по нему отключён. Здесь — прямой факт:
-- сборочное задание Marketplace существует только у FBS-заказа.
--
-- srid: у статистики srid соответствует rid сборочного задания Marketplace —
-- по нему заказ из wb_orders однозначно опознаётся как FBS.
-- Отдельная таблица, а не колонка в wb_orders: факт приходит из другого API в
-- своём ритме, и обновлять строки чужого синка по срид — гонка двух писателей.

create table if not exists public.wb_fbs_orders (
  cabinet_id uuid not null references public.wb_cabinets(id) on delete cascade,
  srid text not null,
  nm_id bigint not null,
  created_at_wb timestamptz,
  synced_at timestamptz not null default now(),
  primary key (cabinet_id, srid)
);

create index if not exists wb_fbs_orders_nm_idx on public.wb_fbs_orders (cabinet_id, nm_id);
create index if not exists wb_fbs_orders_created_idx on public.wb_fbs_orders (cabinet_id, created_at_wb);

comment on table public.wb_fbs_orders is 'Сборочные задания FBS из Marketplace API: прямой признак схемы продажи. srid соответствует rid задания.';

alter table public.wb_fbs_orders enable row level security;
revoke all privileges on public.wb_fbs_orders from anon, authenticated;
grant all privileges on public.wb_fbs_orders to service_role;
