-- Мультикабинетные WB-факты должны конфликтовать внутри кабинета, а не глобально
-- по nm/дате/складу. Иначе синк одного кабинета может перезаписать воронку,
-- рекламу или остатки другого кабинета с тем же nm_id.

alter table public.wb_stocks
  drop constraint if exists wb_stocks_nm_id_warehouse_key;

create unique index if not exists wb_stocks_cabinet_nm_warehouse_uniq
  on public.wb_stocks (cabinet_id, nm_id, warehouse) nulls not distinct;

alter table public.wb_funnel_daily
  drop constraint if exists wb_funnel_daily_nm_id_date_key;

create unique index if not exists wb_funnel_daily_cabinet_nm_date_uniq
  on public.wb_funnel_daily (cabinet_id, nm_id, date) nulls not distinct;

alter table public.wb_advert_nm_daily
  drop constraint if exists wb_advert_nm_daily_nm_id_date_key;

create unique index if not exists wb_advert_nm_daily_cabinet_nm_date_uniq
  on public.wb_advert_nm_daily (cabinet_id, nm_id, date) nulls not distinct;

alter table public.wb_adverts
  drop constraint if exists wb_adverts_advert_id_key;

create unique index if not exists wb_adverts_cabinet_advert_uniq
  on public.wb_adverts (cabinet_id, advert_id) nulls not distinct;

alter table public.wb_advert_stats
  drop constraint if exists wb_advert_stats_advert_id_date_key;

create unique index if not exists wb_advert_stats_cabinet_advert_date_uniq
  on public.wb_advert_stats (cabinet_id, advert_id, date) nulls not distinct;
