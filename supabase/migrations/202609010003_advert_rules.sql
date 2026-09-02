-- Автоправила ставок и опора для суточного лимита пополнений.
--
-- Две вещи, которых не хватало модулю управления рекламой.
--
-- Первая — правила. До сих пор любое изменение ставки делал человек руками;
-- правило делает то же самое по расписанию, поэтому оно обязано хранить не
-- только цель, но и границы, за которые ему нельзя выходить. Границы лежат
-- в строке правила, а не в коде: потолок ставки — это решение владельца
-- кабинета, и менять его через деплой неправильно.
--
-- Вторая — журнал прогонов. Правило, которое молча не сработало, неотличимо
-- от правила, которое сработало и ничего не изменило. Поэтому в
-- advert_rule_runs пишется КАЖДЫЙ прогон, включая решение «ничего не делаю»
-- вместе с причиной. Без этого разбор «почему ставка не двигалась неделю»
-- превращается в гадание.
--
-- advert_bid_changes здесь не создаётся: таблица и её расширенные колонки
-- заведены миграцией 20260714_wb_data_reliability.sql. Добавляется только
-- индекс под новый запрос суточного лимита.

-- Суточный лимит пополнений считает сумму по кабинету за московские сутки:
-- фильтр action='deposit' + status='ok' + created_at. Существующий индекс
-- (cabinet_id, created_at desc) заставляет читать все действия кабинета за
-- день, чтобы оставить из них одни пополнения. Частичный индекс сужает это до
-- самих пополнений — их единицы против сотен изменений ставок.
create index if not exists advert_bid_changes_deposit_idx
  on public.advert_bid_changes (cabinet_id, created_at desc)
  where action = 'deposit' and status = 'ok';

comment on index public.advert_bid_changes_deposit_idx is
  'Суточный лимит пополнений: сумма успешных deposit по кабинету за сутки.';

create table if not exists public.advert_rules (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.wb_cabinets(id) on delete cascade,
  advert_id bigint not null,
  -- null — правило применяется ко всем артикулам кампании. Отдельная строка на
  -- артикул нужна только там, где у товаров внутри кампании разная экономика.
  nm_id bigint,
  -- Место показа обязательно: ставка в WB задаётся потоварно И поместно, и
  -- правило без этого поля не знает, какую именно ставку оно меняет.
  placement text not null default 'search'
    check (placement in ('search', 'recommendations', 'combined')),

  goal text not null check (goal in ('drr', 'cpo')),
  target numeric not null check (target > 0),
  window_days integer not null default 3 check (window_days between 1 and 30),
  step_percent numeric not null default 10 check (step_percent > 0 and step_percent <= 50),

  min_bid numeric not null check (min_bid > 0),
  max_bid numeric not null check (max_bid > 0),
  -- Порог значимости. Ниже него правило не трогает ставку: реагировать на
  -- два заказа значит реагировать на шум, причём за деньги.
  min_orders integer not null default 5 check (min_orders >= 0),

  enabled boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Границы, заданные наоборот, — не экзотика, а обычная опечатка в форме.
  -- Ловим здесь, а не только в коде: правило переживёт любой роут.
  constraint advert_rules_bid_range check (min_bid <= max_bid)
);

-- Одна кампания × артикул × место — одно правило. Два правила на одну ставку
-- дрались бы между собой каждый прогон, и победитель зависел бы от порядка строк.
create unique index if not exists advert_rules_target_idx
  on public.advert_rules (advert_id, coalesce(nm_id, -1), placement);

create index if not exists advert_rules_cabinet_idx
  on public.advert_rules (cabinet_id, enabled);

alter table public.advert_rules enable row level security;
revoke all on table public.advert_rules from anon, authenticated;

create table if not exists public.advert_rule_runs (
  id bigserial primary key,
  rule_id uuid not null references public.advert_rules(id) on delete cascade,
  advert_id bigint not null,
  nm_id bigint,
  ran_at timestamptz not null default now(),
  -- hold пишется наравне с raise/lower: «ничего не сделал» — это тоже результат,
  -- и без него не отличить бездействие от неработающего правила.
  decision text not null check (decision in ('raise', 'lower', 'hold', 'error')),
  old_bid numeric,
  new_bid numeric,
  reason text,
  -- Факт, на котором принято решение. Хранится вместе с решением, потому что
  -- через неделю пересчитать его по окну уже нельзя: данные за окно изменятся.
  fact jsonb
);

create index if not exists advert_rule_runs_rule_idx
  on public.advert_rule_runs (rule_id, ran_at desc);

create index if not exists advert_rule_runs_recent_idx
  on public.advert_rule_runs (ran_at desc);

alter table public.advert_rule_runs enable row level security;
revoke all on table public.advert_rule_runs from anon, authenticated;
