-- Таблицы для модулей по образцу Inferno: roadmap, журнал изменений карточек, план продаж.

-- 1. Roadmap / задачи
create table if not exists public.roadmap (
  id bigint generated always as identity primary key,
  title text not null,
  body text,
  status text not null default 'todo',   -- todo | doing | done
  priority int not null default 2,        -- 1 высокий .. 3 низкий
  nm_id bigint,                           -- опц. привязка к SKU
  created_at timestamptz default now(),
  done_at timestamptz
);

-- 2. Журнал изменений карточек (дизайн/эффекты): что и когда меняли по SKU
create table if not exists public.card_changes (
  id bigint generated always as identity primary key,
  nm_id bigint not null,
  article text,
  change_type text not null,              -- price | content | photo | seo | other
  note text,
  old_value text,
  new_value text,
  date date not null default current_date,
  created_at timestamptz default now()
);
create index if not exists card_changes_nm_date on public.card_changes (nm_id, date);

-- 3. План продаж по SKU и месяцам
create table if not exists public.sales_plan (
  id bigint generated always as identity primary key,
  nm_id bigint,
  article text not null,
  year int not null,
  month int not null,                     -- 1..12
  plan_orders int default 0,
  plan_revenue numeric default 0,
  updated_at timestamptz default now(),
  unique (article, year, month)
);

alter table public.roadmap enable row level security;
alter table public.card_changes enable row level security;
alter table public.sales_plan enable row level security;
create policy "Allow all access to roadmap" on public.roadmap for all using (true) with check (true);
create policy "Allow all access to card_changes" on public.card_changes for all using (true) with check (true);
create policy "Allow all access to sales_plan" on public.sales_plan for all using (true) with check (true);
