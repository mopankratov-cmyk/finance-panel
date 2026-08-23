-- Коды маркировки сборочных заданий в базе.
--
-- WB отдаёт код только по ОДНОМУ заданию за запрос: на кабинете Оптимы это
-- 673 задания за неделю, из которых экран успевает проверить 120 и упирается
-- в бюджет запросов, а «Сверка оборота» падает с «WB ограничил частоту».
--
-- Коды кэшировались через unstable_cache — тот самый кэш, который не общий
-- между роутами и сбрасывается новой сборкой (см. историю с карточками WB).
-- Поэтому прогресс терялся, и каждый заход начинал опрос почти с нуля.
--
-- Код, привязанный к заданию, уже не меняется — значит его можно запомнить
-- навсегда. Тогда каждый следующий заход тратит бюджет только на новые
-- задания, и через несколько прогонов проверенными оказываются все.
--
-- Отсутствие кода НЕ запоминаем: продавец привяжет код через минуту, а
-- запись «кода нет» держала бы это как факт. В таблице только найденные.
create table if not exists public.wb_fbs_order_kiz (
  cabinet_id uuid not null,
  order_id   bigint not null,
  codes      text[] not null,
  checked_at timestamptz not null default now(),
  primary key (cabinet_id, order_id)
);

create index if not exists wb_fbs_order_kiz_cabinet_idx
  on public.wb_fbs_order_kiz (cabinet_id);

alter table public.wb_fbs_order_kiz enable row level security;
revoke all on table public.wb_fbs_order_kiz from anon, authenticated;
grant all on table public.wb_fbs_order_kiz to service_role;
