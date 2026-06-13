-- План по SKU в режиме планирования РНП (ячейка = shop+month+nm+field).
create table if not exists public.rnp_plan (
  shop text not null,
  month text not null,
  nm text not null,
  field text not null,
  value numeric,
  updated_at timestamptz default now(),
  primary key (shop, month, nm, field)
);
alter table public.rnp_plan enable row level security;
create policy "all" on public.rnp_plan for all using (true) with check (true);
