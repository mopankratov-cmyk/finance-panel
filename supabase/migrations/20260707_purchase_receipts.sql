-- «Приёмка товара от поставщика на склад» (goods receiving) — НЕ «платная приёмка WB»
-- (комиссия WB за приёмку поставки, lib/wb/commissions.ts, app/api/wb/losses/route.ts) —
-- та НЕ ТРОГАЕТСЯ, это другая, уже существующая финансовая метрика.
--
-- Плоский per-SKU лог (без отдельной таблицы "заказов поставщику" — 2 нормализованные
-- таблицы ради ручного MVP-учёта избыточны). batch_id — НЕ внешний ключ и не SQL-дефолт,
-- а просто общая метка (crypto.randomUUID() на стороне API-роута, как везде в репо —
-- см. lib/db.ts, lib/format.ts, components/payments/ddsImport.ts), которой помечаются
-- все строки, заведённые одним действием "Оформить поставку" — чтобы закрыть их разом
-- ("поставщик больше не довезёт"), не создавая вторую таблицу ради этого.
--
-- 2 статуса, не больше: expected (ждём) → received (зафиксировали факт — финально,
-- сколько бы ни приехало). Недопоставка — НЕ отдельный статус, а просто
-- receivedQty < expectedQty при status='received' (видно как расхождение). Если остаток
-- довезут отдельной поставкой позже — заводится новая строка, а не переоткрытие старой.
--
-- source — задел под МойСклад (#11, отдельно и потом): когда интеграция появится, её синк
-- сможет писать сюда source='moysklad' вместо ручного ввода, без изменений схемы.

create table if not exists public.purchase_receipts (
  id            bigint generated always as identity primary key,
  batch_id      uuid not null,
  cabinet_id    uuid not null references public.wb_cabinets(id) on delete cascade,
  nm_id         bigint not null,
  article       text not null default '',
  expected_qty  integer not null check (expected_qty > 0),
  expected_at   date,
  warehouse     text,
  received_qty  integer check (received_qty >= 0),
  received_at   timestamptz,
  status        text not null default 'expected' check (status in ('expected', 'received')),
  source        text not null default 'manual' check (source in ('manual', 'moysklad')),
  note          text,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists purchase_receipts_batch_idx on public.purchase_receipts (batch_id);
create index if not exists purchase_receipts_cabinet_status_idx on public.purchase_receipts (cabinet_id, status);
create index if not exists purchase_receipts_nm_idx on public.purchase_receipts (nm_id);

alter table public.purchase_receipts enable row level security;
create policy "all" on public.purchase_receipts for all using (true) with check (true);
