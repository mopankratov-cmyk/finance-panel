-- Снимки SEO-позиций по дням.
-- WB search-texts отдаёт только медиану за период (medianPosition.current), без посуточной
-- истории → копим снимок раз в день, дневной ряд накапливается вперёд (прошлое WB не отдаёт).
-- Безопасно прогнать повторно.
create table if not exists public.wb_seo_positions (
  nm_id           bigint  not null,
  keyword         text    not null,
  frequency       integer,
  median_position integer,
  cabinet_id      uuid,
  snapshot_date   date    not null,
  synced_at       timestamptz default now(),
  primary key (nm_id, keyword, snapshot_date)
);
create index if not exists wb_seo_positions_nm_date_idx
  on public.wb_seo_positions (nm_id, snapshot_date desc);
