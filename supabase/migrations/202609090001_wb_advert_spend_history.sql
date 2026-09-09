-- «История затрат» на рекламу WB (GET /adv/v1/upd) — в отличие от
-- wb_advert_nm_daily (fullstats, расход по дням активности кампании на
-- каждый nm_id), этот отчёт даёт факт списания по документу с указанием
-- ИСТОЧНИКА денег: "Баланс" (реальные деньги продавца) или "Промо бонусы"
-- (бесплатные бонусные рубли WB). Нужен для строки "Бонусы" в ОПиУ и для
-- того, чтобы в валовую прибыль шёл расход только с баланса, без бонусов —
-- см. lib/opiu/adsSpendBySource.ts.
--
-- Ключ строки синтетический (WB не выдаёт стабильный row id на строку
-- отчёта, только номер документа — а один документ закрывает пачку строк).
create table if not exists public.wb_advert_spend_history (
  id             text primary key,
  cabinet_id     uuid not null,
  advert_id      bigint not null,
  campaign_name  text,
  payment_type   text not null, -- как прислал WB: "Баланс" | "Промо бонусы" | ...
  amount         numeric not null default 0,
  doc_number     bigint,
  charged_at     timestamptz not null,
  date           date not null,
  synced_at      timestamptz not null default now()
);

comment on table public.wb_advert_spend_history is
  'WB "История затрат" на рекламу (adv/v1/upd) — списания по источнику (баланс/промо бонусы), в отличие от wb_advert_nm_daily (суммарный расход по дням активности).';

create index if not exists wb_advert_spend_history_cabinet_date_idx
  on public.wb_advert_spend_history (cabinet_id, date);

create index if not exists wb_advert_spend_history_advert_id_idx
  on public.wb_advert_spend_history (advert_id);

alter table public.wb_advert_spend_history enable row level security;
revoke all on table public.wb_advert_spend_history from anon, authenticated;
grant all on table public.wb_advert_spend_history to service_role;

notify pgrst, 'reload schema';
