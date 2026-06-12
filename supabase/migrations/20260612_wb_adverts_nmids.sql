-- Привязка кампаний к артикулам (для распределения расхода по nm_id в РНП).
alter table public.wb_adverts
  add column if not exists nm_ids bigint[];
