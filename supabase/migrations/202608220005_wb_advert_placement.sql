-- Вид размещения приходит от WB, а не собирается из величины ставок.
--
-- Сырая карточка v2/adverts содержит settings.placements {search,
-- recommendations} и settings.payment_type (cpc/cpm) — ровно то, что журнал
-- РК раскладывает по блокам. Синк читал из settings только имя кампании, и
-- вид приходилось угадывать по порядку ставки (единицы рублей = CPC, сотни =
-- CPM) с ручной доразметкой сотен кампаний. Теперь берём факт.

alter table public.wb_adverts add column if not exists payment_type text;
alter table public.wb_adverts add column if not exists placement_search boolean;
alter table public.wb_adverts add column if not exists placement_shelf boolean;

comment on column public.wb_adverts.payment_type is 'Модель оплаты кампании как её отдаёт WB: cpc (за клик) или cpm (за 1000 показов).';
comment on column public.wb_adverts.placement_search is 'Кампания крутится в поиске (settings.placements.search). NULL — WB признак не отдал.';
comment on column public.wb_adverts.placement_shelf is 'Кампания крутится на полках/в рекомендациях (settings.placements.recommendations). NULL — WB признак не отдал.';
