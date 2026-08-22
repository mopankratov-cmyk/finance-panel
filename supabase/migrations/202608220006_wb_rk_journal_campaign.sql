-- Журнал РК: снимок хранится по кампаниям, а не по видам размещения.
--
-- Экран группируется как в кабинете WB: строка — артикул, внутри — его
-- кампании. Снимок 06:00 складывал кампании в блок ещё при записи, поэтому
-- за снятые дни кампании было не показать. Гранулярность «кампания» ниже:
-- из неё собирается и вид размещения, и итог по артикулу, а обратно — нет.
--
-- Старые строки снимка (без advert_id) удаляются: они пересобираются из
-- слоя wb_advert_nm_campaign_daily прогоном /api/sync/rk-journal за нужную
-- дату, терять нечего.

alter table public.wb_rk_journal_daily add column if not exists advert_id bigint;
comment on column public.wb_rk_journal_daily.advert_id is 'Кампания WB. Снимок хранится по кампаниям — вид размещения и итог по артикулу собираются из них.';

delete from public.wb_rk_journal_daily where advert_id is null;

do $$ begin
  alter table public.wb_rk_journal_daily drop constraint if exists wb_rk_journal_daily_key;
  alter table public.wb_rk_journal_daily
    add constraint wb_rk_journal_daily_key
    unique nulls not distinct (cabinet_id, date, nm_id, advert_id);
exception when duplicate_object then null; end $$;

create index if not exists wb_rk_journal_daily_nm_date_idx
  on public.wb_rk_journal_daily (cabinet_id, nm_id, date);
