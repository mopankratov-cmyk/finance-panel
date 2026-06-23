-- Репрайсер: rule-engine управления ценой (порт логики infernoff).
-- Стратегия = {action, amount%, conditions[], margin_floor}. Крон сверяет метрики SKU «за вчера»
-- и пишет решения old→new (применение — human-in-the-loop через XLSX, как сейчас в design/price-update).

create table if not exists public.repricer_strategies (
  id bigint generated always as identity primary key,
  name text not null,
  action text not null,                       -- dec_pct | inc_pct
  amount numeric not null,                    -- % шага
  margin_floor numeric not null default 15,   -- не опускать маржу ниже, %
  conditions jsonb not null default '[]',     -- [{metric, op, value}] · metric: gmroi|stock|drr|turnover|margin
  priority int not null default 100,          -- меньше = выше приоритет при матче
  enabled boolean not null default true,
  created_at timestamptz default now()
);

create table if not exists public.repricer_decisions (
  id bigint generated always as identity primary key,
  run_date date not null,
  cabinet text,
  nm_id bigint not null,
  article text,
  strategy_id bigint references public.repricer_strategies(id) on delete set null,
  strategy_name text,
  old_price numeric,
  new_price numeric,
  metrics jsonb,                              -- снимок ctr/drr/gmroi/margin/stock/turnover
  used jsonb,                                 -- сработавшие условия (объяснимость)
  status text not null default 'proposed',    -- proposed | skipped | exported | applied
  note text,
  created_at timestamptz default now()
);
create index if not exists repricer_decisions_run on public.repricer_decisions (run_date, cabinet);
create unique index if not exists repricer_decisions_uniq on public.repricer_decisions (run_date, nm_id, coalesce(cabinet, ''));

alter table public.repricer_strategies enable row level security;
alter table public.repricer_decisions enable row level security;
drop policy if exists "all" on public.repricer_strategies;
create policy "all" on public.repricer_strategies for all using (true) with check (true);
drop policy if exists "all" on public.repricer_decisions;
create policy "all" on public.repricer_decisions for all using (true) with check (true);

-- Сид-стратегии (как у Юры; margin_floor 15%). Идемпотентно по имени.
insert into public.repricer_strategies (name, action, amount, margin_floor, conditions, priority)
select v.name, v.action, v.amount, 15, v.conditions::jsonb, v.priority
from (values
  ('Разгон GMROI', 'dec_pct', 5,  '[{"metric":"gmroi","op":"<","value":200},{"metric":"stock","op":">","value":50},{"metric":"drr","op":">","value":5},{"metric":"turnover","op":">","value":50}]', 10),
  ('Рост маржи',   'inc_pct', 5,  '[{"metric":"gmroi","op":">","value":200},{"metric":"stock","op":">","value":50}]', 20),
  ('Скоро аут',    'inc_pct', 10, '[{"metric":"gmroi","op":">","value":200},{"metric":"stock","op":"<","value":50}]', 15),
  ('ДРР позволяет','inc_pct', 5,  '[{"metric":"drr","op":"<","value":5},{"metric":"gmroi","op":">","value":150}]', 30)
) as v(name, action, amount, conditions, priority)
where not exists (select 1 from public.repricer_strategies s where s.name = v.name);
