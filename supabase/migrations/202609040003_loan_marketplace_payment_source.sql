-- Удержание маркетплейсом — самостоятельный факт оплаты, а не банковский
-- платёж из ДДС. Храним его ключ прямо у строки графика, чтобы один rrd_id WB
-- нельзя было случайно зачесть дважды и не создавать фиктивный денежный поток.
alter table public.loan_schedule_rows
  add column if not exists paid_by_marketplace_source text;

create unique index if not exists loan_schedule_rows_marketplace_source_unique
  on public.loan_schedule_rows (paid_by_marketplace_source)
  where paid_by_marketplace_source is not null;

comment on column public.loan_schedule_rows.paid_by_marketplace_source is
  'Внешний факт оплаты из кабинета маркетплейса, например wb:<cabinet_id>:<rrd_id>.';
