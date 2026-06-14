-- Бэкфилл cabinet_id для исторических строк (синканных до мультикабинета, cabinet_id=NULL).
-- nm_id на WB принадлежит ровно одному кабинету → берём привязку из размеченных строк
-- (wb_stocks — полный снимок, каждый активный nm уже помечен кабинетом).
-- Идемпотентно: трогает только NULL-строки. Безопасно прогнать повторно.

update wb_orders o set cabinet_id = s.cabinet_id
  from (select distinct on (nm_id) nm_id, cabinet_id from wb_stocks
        where cabinet_id is not null order by nm_id, synced_at desc) s
  where o.cabinet_id is null and o.nm_id = s.nm_id;

update wb_sales o set cabinet_id = s.cabinet_id
  from (select distinct on (nm_id) nm_id, cabinet_id from wb_stocks
        where cabinet_id is not null order by nm_id, synced_at desc) s
  where o.cabinet_id is null and o.nm_id = s.nm_id;

update wb_funnel_daily o set cabinet_id = s.cabinet_id
  from (select distinct on (nm_id) nm_id, cabinet_id from wb_stocks
        where cabinet_id is not null order by nm_id, synced_at desc) s
  where o.cabinet_id is null and o.nm_id = s.nm_id;

update wb_advert_nm_daily o set cabinet_id = s.cabinet_id
  from (select distinct on (nm_id) nm_id, cabinet_id from wb_stocks
        where cabinet_id is not null order by nm_id, synced_at desc) s
  where o.cabinet_id is null and o.nm_id = s.nm_id;

-- Статистика кампаний: advert_id → кабинет из wb_adverts.
update wb_advert_stats a set cabinet_id = w.cabinet_id
  from (select distinct on (advert_id) advert_id, cabinet_id from wb_adverts
        where cabinet_id is not null order by advert_id) w
  where a.cabinet_id is null and a.advert_id = w.advert_id;
