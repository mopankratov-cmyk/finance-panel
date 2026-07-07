-- Кэш факт-комиссии/эквайринга/прочих удержаний WB по nm (см. lib/wb/commissions.ts).
-- Раньше getWbCommissionMerged на КАЖДЫЙ запрос РНП/юнита фанила тяжёлый финотчёт
-- (reportDetailByPeriod, ~12с) по каждому активному кабинету. Теперь синк (app/api/sync/commissions)
-- считает это раз в сутки и пишет сюда; commissions.ts читает эту таблицу и фолбэчится
-- на live-запрос только если кэш ещё пуст (первый запуск/синк не прошёл).

create table if not exists public.wb_nm_commissions (
  cabinet_id uuid not null references public.wb_cabinets(id) on delete cascade,
  nm_id bigint not null,
  pct numeric not null default 0,
  acq_pct numeric not null default 0,
  extra_pct numeric not null default 0,
  rev numeric not null default 0,
  synced_at timestamptz not null default now(),
  primary key (cabinet_id, nm_id)
);
create index if not exists wb_nm_commissions_nm on public.wb_nm_commissions (nm_id);

-- Account-level удержания без nm_id (плоская надбавка ко всем SKU кабинета) + revenue кабинета
-- за то же окно — нужен для взвешивания overhead при мердже нескольких кабинетов.
create table if not exists public.wb_cabinet_commission_overhead (
  cabinet_id uuid primary key references public.wb_cabinets(id) on delete cascade,
  overhead_pct numeric not null default 0,
  rev numeric not null default 0,
  synced_at timestamptz not null default now()
);

alter table public.wb_nm_commissions enable row level security;
alter table public.wb_cabinet_commission_overhead enable row level security;
create policy "all" on public.wb_nm_commissions for all using (true) with check (true);
create policy "all" on public.wb_cabinet_commission_overhead for all using (true) with check (true);
