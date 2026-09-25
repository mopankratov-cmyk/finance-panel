-- Ozon: построчные начисления (/v1/finance/accrual/by-day) и отправления
-- (ozonPostings) — по образцу wb_report_rows/wb_sync_state у WB. Ozon 8
-- сентября 2026 отключил /v3/finance/transaction/{list,totals}; это —
-- хранилище под их официальную замену.
--
-- sku хранится как text: у части строк (NON_ITEM — платежи не по конкретному
-- товару, например инвентаризация взаиморасчётов) SKU нет вовсе, а составной
-- первичный ключ не терпит NULL. '-' — тот же приём, что OZON_AD_EMPTY_DAY_SKU
-- в lib/ozon/adDailyMarkers.ts, только локальный для этой таблицы.
create table if not exists public.ozon_accrual_rows (
  cabinet_id       uuid not null references public.wb_cabinets(id) on delete cascade,
  accrual_id       bigint not null,
  sku              text not null default '-',
  type_id          int not null,
  date             date not null,
  unit_number      text,
  -- Свободный text, не enum: Ozon может завтра прислать категорию, которой
  -- сегодня нет в четырёх известных нам значениях (ITEM/POSTING/NON_ITEM) —
  -- constraint на неизвестном значении уронил бы весь синк одной строкой.
  accrued_category text not null,
  amount           numeric not null,
  currency         text not null default 'RUB',
  quantity         int,
  -- Поля commission-блока (seller_price/sale_price/coinvestment/bonus/...),
  -- которые не сводятся к одному type_id — сохраняем как есть, разбор на
  -- отчётные строки решается на слое агрегации, не здесь.
  extra            jsonb,
  updated_at       timestamptz not null default now(),
  primary key (cabinet_id, accrual_id, sku, type_id)
);

create index if not exists ozon_accrual_rows_cabinet_date_idx
  on public.ozon_accrual_rows (cabinet_id, date);

alter table public.ozon_accrual_rows enable row level security;
drop policy if exists "service role manages ozon accrual rows" on public.ozon_accrual_rows;
create policy "service role manages ozon accrual rows"
  on public.ozon_accrual_rows for all using (true) with check (true);

-- Воронка заказов (Доставлено/Отменено/...). status хранится сырым
-- (английские значения Ozon) — перевод в бакет отчёта делает уже
-- существующий describeOzonPostingStatus() (lib/ozon/postingStatus.ts) на
-- слое чтения, а не здесь: так один новый статус Ozon чинится в одном месте.
create table if not exists public.ozon_postings (
  cabinet_id     uuid not null references public.wb_cabinets(id) on delete cascade,
  posting_number text not null,
  scheme         text not null,
  order_number   text,
  status         text not null,
  created_at     timestamptz not null,
  amount         numeric not null default 0,
  units          int not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (cabinet_id, posting_number)
);

create index if not exists ozon_postings_cabinet_created_idx
  on public.ozon_postings (cabinet_id, created_at);
create index if not exists ozon_postings_cabinet_status_idx
  on public.ozon_postings (cabinet_id, status);

alter table public.ozon_postings enable row level security;
drop policy if exists "service role manages ozon postings" on public.ozon_postings;
create policy "service role manages ozon postings"
  on public.ozon_postings for all using (true) with check (true);
