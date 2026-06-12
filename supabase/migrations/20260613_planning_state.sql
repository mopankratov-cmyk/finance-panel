-- Состояние планирования (контракт inferno: целиком {orders, norms, sku_orders} за год).
create table if not exists public.planning_state (
  year int primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);
alter table public.planning_state enable row level security;
create policy "all" on public.planning_state for all using (true) with check (true);
