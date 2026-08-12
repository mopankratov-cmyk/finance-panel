-- Тип склада отгрузки из WB (см. lib/wb/scheme.ts).
-- Метод статистики «Заказы» (/api/v1/supplier/orders) возвращает поле warehouseType
-- со значениями вида «Склад продавца» — по нему и только по нему можно достоверно
-- отличить отгрузку со склада продавца (FBS/DBS) от отгрузки со склада WB (FBW).
-- До сих пор мы сохраняли только warehouseName, и схему приходилось угадывать по
-- названию склада («Виртуальный …», «СЦ …») — на такой эвристике нельзя строить
-- ни отчётность по деньгам, ни разделение остатков.
--
-- Храним СЫРОЕ значение WB, а не свою классификацию: если WB добавит новый тип
-- склада, запись не сломается и не потеряет факт, а разметку можно будет поправить
-- в коде без повторной синхронизации.
--
-- Колонки nullable без default: строки, записанные прежним синком, тип склада не
-- знают, и любое подставленное значение было бы выдумкой. Заполнятся при следующем
-- проходе синка; для истории нужен разовый пересинк с forceFrom.

alter table public.wb_orders add column if not exists warehouse_type text;
alter table public.wb_sales add column if not exists warehouse_type text;

comment on column public.wb_orders.warehouse_type is 'Тип склада отгрузки как его отдаёт WB (например «Склад продавца»). NULL — синк записал строку до появления колонки.';
comment on column public.wb_sales.warehouse_type is 'Тип склада отгрузки как его отдаёт WB. NULL — синк записал строку до появления колонки.';

create index if not exists wb_orders_warehouse_type_idx on public.wb_orders (warehouse_type);
