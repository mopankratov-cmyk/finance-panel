-- Журнал РК: замена ручной таблицы «Показы CTR CPC».
--
-- Владелец ведёт руками лист, где строка = (артикул, день, вид размещения), а
-- колонки — Ставка / Корзин / Заказов / Затраты / CPO / CPL. Виды размещения
-- на листе разнесены секциями: «ПОЛКИ СРС», поиск, ЕРК и т.д.
--
-- Метрики уже есть в wb_advert_nm_campaign_daily. Не хватало двух вещей:
--   1) ставки в разрезе поиск/полки — синк писал только bids_kopecks.search
--      первой карточки, и полочная ставка терялась;
--   2) истории ставок — wb_adverts перезаписывается каждым прогоном, поэтому
--      «какая ставка стояла 19.08» из базы уже не узнать.
--
-- Отсюда снимок раз в сутки: метрики закрытого дня + ставка на момент снятия.

alter table public.wb_adverts add column if not exists bid_search_rub numeric;
alter table public.wb_adverts add column if not exists bid_shelf_rub numeric;
alter table public.wb_adverts add column if not exists raw jsonb;
alter table public.wb_adverts add column if not exists block_override text;

comment on column public.wb_adverts.bid_search_rub is 'Ставка в поиске, ₽ (bids_kopecks.search / 100). NULL — WB ставку по кампании не отдал.';
comment on column public.wb_adverts.bid_shelf_rub is 'Ставка на полках/в рекомендациях, ₽ (bids_kopecks.recommendations / 100). NULL — WB ставку не отдал.';
comment on column public.wb_adverts.raw is 'Сырая карточка кампании из v2/adverts. Нужна, чтобы разложить кампании по видам размещения по фактическим полям WB, а не по догадкам об именах.';
comment on column public.wb_adverts.block_override is 'Ручная разметка вида размещения владельцем (cpc_search/cpc_shelf/cpm_search/cpm_shelf/erk). Приоритетнее автоклассификации; синк кампаний её не трогает.';

-- Снимок дня. Ключ (кабинет, дата, артикул, вид размещения) повторяет строку
-- ручного листа. Пересняться за дату можно — upsert идемпотентен.
create table if not exists public.wb_rk_journal_daily (
  cabinet_id  uuid,
  date        date not null,
  nm_id       bigint not null,
  block       text not null,
  bid         numeric,
  views       int not null default 0,
  clicks      int not null default 0,
  spent       numeric not null default 0,
  carts       int not null default 0,
  orders      int not null default 0,
  orders_sum  numeric not null default 0,
  campaigns   int not null default 0,
  captured_at timestamptz not null default now()
);

-- cabinet_id бывает null (общий seller-токен): nulls not distinct делает null
-- равным null в ключе — иначе PostgREST upsert плодил бы дубли.
do $$ begin
  alter table public.wb_rk_journal_daily
    add constraint wb_rk_journal_daily_key
    unique nulls not distinct (cabinet_id, date, nm_id, block);
exception when duplicate_object then null; end $$;

create index if not exists wb_rk_journal_daily_cabinet_date_idx
  on public.wb_rk_journal_daily (cabinet_id, date);

alter table public.wb_rk_journal_daily enable row level security;
revoke all on table public.wb_rk_journal_daily from anon, authenticated;
grant all on table public.wb_rk_journal_daily to service_role;
