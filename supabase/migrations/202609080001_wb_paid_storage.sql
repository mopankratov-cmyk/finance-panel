-- «Платное хранение» WB (GET /api/v1/paid_storage) — отдельный от финотчёта
-- отчёт, где расход хранения привязан к конкретному nmId/vendorCode. В
-- финотчёте (wb_report_rows.storage_fee) те же деньги приходят одной
-- обезличенной суммой на кабинет (nm_id: 0, sa_name: null) — их нельзя
-- разложить по товару и, соответственно, по суб-бренду внутри общего
-- кабинета (Norvia/Heaton на Retail Family). Этот отчёт даёт то самое
-- разложение — как в вкладке «Платное хранение» реф-таблицы владельца.
--
-- Ключ строки синтетический (WB не выдаёт row id для этого отчёта): дата +
-- баркод + giId + chrtId + calcType однозначно определяют строку по факту
-- наблюдения за реальными ответами WB.
create table if not exists public.wb_paid_storage_rows (
  id                text primary key,
  cabinet_id        uuid not null,
  date              date not null,
  nm_id             bigint,
  vendor_code       text,
  barcode           text,
  subject           text,
  brand             text,
  warehouse         text,
  office_id         bigint,
  gi_id             bigint,
  chrt_id           bigint,
  size              text,
  volume            numeric,
  calc_type         text,
  warehouse_price   numeric not null default 0,
  barcodes_count    numeric,
  synced_at         timestamptz not null default now()
);

comment on table public.wb_paid_storage_rows is
  'WB "Платное хранение" (seller-analytics-api /api/v1/paid_storage) — хранение по nmId/vendorCode, в отличие от обезличенного wb_report_rows.storage_fee.';

create index if not exists wb_paid_storage_rows_cabinet_date_idx
  on public.wb_paid_storage_rows (cabinet_id, date);

create index if not exists wb_paid_storage_rows_vendor_code_idx
  on public.wb_paid_storage_rows (vendor_code);

alter table public.wb_paid_storage_rows enable row level security;
revoke all on table public.wb_paid_storage_rows from anon, authenticated;
grant all on table public.wb_paid_storage_rows to service_role;

notify pgrst, 'reload schema';
