-- Воронка/РНП: сборка снимка CLERIN шла 11-12 секунд на 12 SKU.
--
-- Причина: rnp_daily_sku / rnp_daily / внутренности rnp_report фильтруют
-- факт-таблицы предикатом `date::date between p_from and p_to`. Приведение
-- КОЛОНКИ к date отключает существующие индексы по (cabinet_id, date, ...) —
-- Postgres не может использовать btree по date для выражения date::date, и
-- каждый вызов сканирует всю историю кабинета.
--
-- Лечение — выражение-индексы ровно под этот предикат. Семантика функций не
-- меняется (это важно: date::date усечение идёт в таймзоне сессии, и menять
-- предикаты на сравнение timestamptz — отдельное минное поле). Замер до:
-- totals_rpc 11218 мс, daily_sku 11271 мс (?timings=1 на проде, 22.08.2026).

create index if not exists wb_orders_cabinet_dateday_nm_idx
  on public.wb_orders (cabinet_id, (date::date), nm_id);

create index if not exists wb_sales_cabinet_dateday_nm_idx
  on public.wb_sales (cabinet_id, (date::date), nm_id);

create index if not exists wb_advert_nm_daily_cabinet_dateday_nm_idx
  on public.wb_advert_nm_daily (cabinet_id, (date::date), nm_id);

-- Для режима «все кабинеты» (p_cabinet is null) те же предикаты идут без
-- фильтра по кабинету — покрываем и их.
create index if not exists wb_orders_dateday_nm_idx
  on public.wb_orders ((date::date), nm_id);

create index if not exists wb_sales_dateday_nm_idx
  on public.wb_sales ((date::date), nm_id);

create index if not exists wb_advert_nm_daily_dateday_nm_idx
  on public.wb_advert_nm_daily ((date::date), nm_id);
