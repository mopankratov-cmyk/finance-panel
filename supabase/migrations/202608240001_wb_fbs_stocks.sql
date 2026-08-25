-- Остатки на складах продавца (FBS) в базе.
--
-- Зачем таблица. В wb_stocks лежат остатки со складов WB — это FBO. Остатков
-- на СВОЁМ складе там нет вовсе: WB отдаёт их другим методом Marketplace API,
-- отдельно по каждому складу продавца и только по списку баркодов. Поэтому
-- «общий остаток» в воронке до сих пор равнялся FBO и молча занижал правду у
-- кабинетов со своим складом.
--
-- Почему нельзя было разделить по признаку склада: WB тем же признаком метит
-- транзитные СЦ, и сплит ФБО/ФБС по нему в проекте уже пробовали и отключили
-- (см. комментарий в 202608190001_wb_fbs_orders.sql). Здесь разделения нет
-- по построению — источник другой.
--
-- Почему в базу, а не живым запросом с экрана: обход требует прогретого
-- справочника баркодов и по запросу на каждую тысячу баркодов на каждый склад.
-- Живьём это укладывается только в отдельную вкладку с ожиданием, а воронке
-- нужен мгновенный ответ.
create table if not exists public.wb_fbs_stocks (
  cabinet_id uuid not null references public.wb_cabinets(id) on delete cascade,
  nm_id      bigint not null,
  -- Сумма по всем складам продавца и всем размерам товара.
  quantity   integer not null default 0,
  -- Сколько складов реально опрошено: неполный обход не должен выглядеть
  -- как «на складах пусто».
  warehouses integer not null default 0,
  synced_at  timestamptz not null default now(),
  primary key (cabinet_id, nm_id)
);

create index if not exists wb_fbs_stocks_cabinet_idx on public.wb_fbs_stocks (cabinet_id);

comment on table public.wb_fbs_stocks is 'Остатки на складах продавца (FBS) из Marketplace API. FBO лежит отдельно в wb_stocks — источники разные, не смешивать.';
comment on column public.wb_fbs_stocks.quantity is 'Сумма остатка по всем складам продавца и всем размерам nm_id.';
comment on column public.wb_fbs_stocks.warehouses is 'Сколько складов продавца попало в этот подсчёт.';

alter table public.wb_fbs_stocks enable row level security;
revoke all privileges on public.wb_fbs_stocks from anon, authenticated;
grant all privileges on public.wb_fbs_stocks to service_role;
