-- Авто-докидывание бюджета рекламы (порт «докидывания» infernoff).
-- БЕЗОПАСНО ПО УМОЛЧАНИЮ: enabled=false; реальный депозит срабатывает только для кампаний,
-- которые владелец явно включил. Глобальный kill-switch — env ADVERT_DOCKING_OFF=1.

create table if not exists public.advert_docking_config (
  id bigint generated always as identity primary key,
  cabinet text,                               -- id кабинета (wb_cabinets.id) для выбора токена
  advert_id bigint not null unique,
  nm_id bigint,
  name text,
  enabled boolean not null default false,     -- ВКЛ = разрешение на авто-списание бюджета этой РК
  hours int[] not null default '{}',          -- окна МСК (часы 0-23); пусто = каждый час
  amount_rub numeric not null default 1000,   -- сколько докидывать
  threshold_rub numeric not null default 300, -- докидывать если бюджет ниже
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.advert_docking_log (
  id bigint generated always as identity primary key,
  advert_id bigint not null,
  hour int,
  budget_before numeric,
  amount numeric,
  action text,                                -- deposit | relaunch | deposit+relaunch | skip
  status text not null,                       -- ok | error | dry
  detail text,
  created_at timestamptz default now()
);
create index if not exists advert_docking_log_adv on public.advert_docking_log (advert_id, created_at);

alter table public.advert_docking_config enable row level security;
alter table public.advert_docking_log enable row level security;
create policy "all" on public.advert_docking_config for all using (true) with check (true);
create policy "all" on public.advert_docking_log for all using (true) with check (true);
