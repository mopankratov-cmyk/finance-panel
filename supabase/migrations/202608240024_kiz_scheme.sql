-- Схема продажи в реестре кодов — ТОЛЬКО СХЕМА, без функций.
--
-- Ошибка, которую это чинит, стоила бы дорого. Отчёт Wildberries по
-- маркированным товарам отдаёт операции по ВСЕМ схемам, включая FBW. А при FBW
-- код из оборота выводит сам маркетплейс: он владеет товаром в момент продажи.
-- Наше дело — только FBS, где товар до последнего момента наш.
--
-- Без этого различения в файл на вывод уходили бы чужие операции. На живых
-- данных это не теория: у кабинета Retail Family 39 356 заказов, из них по схеме
-- FBS всего 124 — то есть почти весь собранный список состоял бы из кодов,
-- которые Wildberries уже вывел сам.
--
-- Схему определяет заказ: srid из отчёта находит строку в wb_orders, где
-- warehouse_type говорит «Склад продавца» (FBS) или «Склад WB» (FBW).

alter table public.kiz_withdrawals
  add column if not exists srid text,
  -- 'fbs' — выводим мы, 'fbw' — вывел маркетплейс, null — заказ не найден.
  add column if not exists scheme text;

create index if not exists kiz_withdrawals_srid_idx
  on public.kiz_withdrawals (srid);

-- Статусы, которых не хватало:
--   fbw     — вывел маркетплейс, нам делать нечего;
--   unknown — заказ по srid не найден, схему определить нечем. Отправлять такой
--             код нельзя: если он окажется FBW, мы попытаемся вывести уже
--             выведенное.
alter table public.kiz_withdrawals
  drop constraint if exists kiz_withdrawals_status_check;
alter table public.kiz_withdrawals
  add constraint kiz_withdrawals_status_check
  check (status in ('sold', 'returned', 'sent', 'returned_after_sent', 'fbw', 'unknown'));

comment on column public.kiz_withdrawals.scheme is
  'Схема продажи: fbs — выводим мы, fbw — вывел Wildberries, null — заказ не найден.';

notify pgrst, 'reload schema';
