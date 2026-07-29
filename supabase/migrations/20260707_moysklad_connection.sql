-- Подключение МойСклад (внешняя система складского учёта) как будущего источника
-- данных для модуля Закупки. Практически всегда одна запись (один аккаунт компании) —
-- без жёсткого UNIQUE, тот же паттерн "проверить существование → update/insert", что
-- и wb_cabinets (app/api/cabinets/route.ts).
--
-- ЭТО ТОЛЬКО ФОРМА ПОДКЛЮЧЕНИЯ + ЗАГЛУШКА СИНКА (app/api/sync/moysklad/route.ts):
-- сохраняем и проверяем валидность токена, но импорт товаров/остатков в
-- product_costs/wb_stocks ещё не реализован — нет решения, что именно маппить.

create table if not exists public.moysklad_connection (
  id              bigint generated always as identity primary key,
  token           text not null,
  account_name    text,
  is_active       boolean not null default true,
  last_sync_at    timestamptz,
  last_sync_error text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.moysklad_connection enable row level security;
create policy "all" on public.moysklad_connection for all using (true) with check (true);
