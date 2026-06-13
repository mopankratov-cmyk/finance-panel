-- Пользователи приложения + роли (RBAC).
create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  role text not null default 'manager',      -- 'director' | 'finance' | 'manager'
  cabinet_ids uuid[] default '{}',            -- для менеджера: назначенные кабинеты ([] = все)
  is_active boolean default true,
  created_at timestamptz default now()
);
alter table public.app_users enable row level security;
create policy "all" on public.app_users for all using (true) with check (true);

-- Мультикабинет (инфраструктура): тег cabinet_id на синкуемые WB-таблицы.
-- Заполняется при per-cabinet синке (следующая фаза). NULL = текущий env-кабинет.
alter table public.wb_orders          add column if not exists cabinet_id uuid;
alter table public.wb_sales           add column if not exists cabinet_id uuid;
alter table public.wb_stocks          add column if not exists cabinet_id uuid;
alter table public.wb_funnel_daily    add column if not exists cabinet_id uuid;
alter table public.wb_adverts         add column if not exists cabinet_id uuid;
alter table public.wb_advert_stats    add column if not exists cabinet_id uuid;
alter table public.wb_advert_nm_daily add column if not exists cabinet_id uuid;
