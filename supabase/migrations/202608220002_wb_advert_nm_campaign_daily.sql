-- Реклама по артикулам: лечение мигающих нулей + корзины из РК.
--
-- Симптом: в Воронке/РНП у артикула нули по рекламе, «хотя РК была включена»
-- (СЛОЁНО, nm 774084816, 15-21.08 — при живом токене и 1.3 млн ₽ расходов по
-- кабинету за период).
--
-- Причина: fullstats забирается срезами по 50 кампаний (до 4 срезов за
-- прогон), а wb_advert_nm_daily агрегируется ТОЛЬКО из кампаний текущего
-- среза и апсертится поверх. Артикул, чья статистика размазана по кампаниям
-- из разных срезов («СРС куртки part 2/3», ЕРК + СРС на один nm), получает
-- частичную или нулевую сумму каждый раз, когда прогон видит не все его
-- кампании.
--
-- Лечение: сырой слой по-кампанийно — каждый срез полон для своих кампаний,
-- и upsert строки (кампания, nm, день) никогда не затирает чужое. Витрина
-- wb_advert_nm_daily пересобирается из этого слоя по затронутым (nm, день).
create table if not exists public.wb_advert_nm_campaign_daily (
  cabinet_id  uuid,
  advert_id   bigint not null,
  nm_id       bigint not null,
  date        date not null,
  views       int not null default 0,
  clicks      int not null default 0,
  spent       numeric not null default 0,
  carts       int not null default 0,
  orders      int not null default 0,
  orders_sum  numeric not null default 0,
  synced_at   timestamptz not null default now()
);

-- cabinet_id бывает null (общий seller-токен без кабинета): nulls not
-- distinct делает null равным null в ключе. Выражение-индекс с coalesce не
-- подошёл бы — PostgREST upsert (on_conflict=колонки) не умеет целиться в
-- выражение-индексы, только в constraint по колонкам.
do $$ begin
  alter table public.wb_advert_nm_campaign_daily
    add constraint wb_advert_nm_campaign_daily_key
    unique nulls not distinct (cabinet_id, advert_id, nm_id, date);
exception when duplicate_object then null; end $$;

create index if not exists wb_advert_nm_campaign_daily_nm_date_idx
  on public.wb_advert_nm_campaign_daily (cabinet_id, nm_id, date);

-- Корзины из РК (atbs из fullstats): без них CPL считать не из чего.
alter table public.wb_advert_nm_daily add column if not exists carts int;
comment on column public.wb_advert_nm_daily.carts is 'Корзины из РК (fullstats atbs), сумма по всем кампаниям артикула за день. NULL — строка записана до появления колонки.';

alter table public.wb_advert_nm_campaign_daily enable row level security;
revoke all on table public.wb_advert_nm_campaign_daily from anon, authenticated;
grant all on table public.wb_advert_nm_campaign_daily to service_role;
