-- Акт расхождений (§10.3 ТЗ, пайплайн 3.1-3.2): решение закупщика, а не
-- просто число.
--
-- Расхождение (недовоз/излишек) и брак СЕГОДНЯ уже фиксируются в проводках:
-- брак — списанием в stock_moves (post_receipt_batch), недовоз/излишек —
-- событием warehouse_events(kind='receipt_discrepancy'). Склад уже печатает
-- «Акт расхождений» (components/warehouse/PrintableDiscrepancy.tsx) — но это
-- только документ для подписи с фабрикой/фулфилментом, без решения закупщика
-- внутри системы. Эта таблица — не дублирует остаток и не пишет в
-- stock_moves/stock_batches вовсе: чистый слой решения поверх уже
-- посчитанного расхождения одной партии приёмки (purchase_receipts.batch_id).
--
-- Один акт на партию (unique по batch_id) — решение принимается по факту
-- партии целиком, а не по отдельной строке внутри неё.

create table if not exists public.discrepancy_acts (
  id                 uuid primary key default gen_random_uuid(),
  purchase_order_id  uuid not null references public.purchase_orders(id) on delete cascade,
  batch_id           uuid not null,
  resolution         text not null check (resolution in ('wait_restock', 'reduce_debt', 'refund', 'accept_replacement', 'claim')),
  status             text not null default 'open' check (status in ('open', 'resolved')),
  note               text,
  created_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  resolved_by        text,
  resolved_at        timestamptz
);

create unique index if not exists discrepancy_acts_batch_unique on public.discrepancy_acts (batch_id);
create index if not exists discrepancy_acts_order_idx on public.discrepancy_acts (purchase_order_id);

alter table public.discrepancy_acts enable row level security;
revoke all on public.discrepancy_acts from anon, authenticated;
notify pgrst, 'reload schema';
