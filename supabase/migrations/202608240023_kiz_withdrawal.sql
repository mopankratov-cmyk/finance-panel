-- Реестр кодов маркировки к выводу из оборота — ТОЛЬКО СХЕМА.
-- (В этом файле нет ни одной функции. Разделение обязательное: редактор
-- Supabase, увидев create table, дописывает включение RLS и промахивается
-- внутрь тела соседней процедуры.)
--
-- Зачем нужен реестр, а не просто вычитание двух файлов.
--
-- Порядок работы задан тем, кто выводит коды: раз в три дня выгружаются
-- завершённые заказы ФБС с фильтром «товар выкуплен», отдельно — отчёт по
-- возвратам за тот же период, из первого вычитается второе, остаток уходит
-- файлом «КИЗ + цена реализации».
--
-- Три вещи, которых вычитание двух файлов не даёт, а реестр даёт:
--   1. Один и тот же код не уйдёт на вывод дважды — даже если периоды в
--      выгрузках перекроются, а они перекрываются всегда.
--   2. Возврат, пришедший ПОЗЖЕ отправки, будет виден. Молча это не исправить:
--      код уже выведен, и вернуть его в оборот может только человек.
--   3. История собирается по кускам: выгрузки за прошлые месяцы можно загружать
--      в любом порядке, реестр сам сложит из них полную картину.

create table if not exists public.kiz_withdrawals (
  -- Код идентификации (31 символ) — ключ дедупликации за всю историю.
  code          text primary key,
  -- Код как он лежал в выгрузке WB. Отправляем его, а не пересобранный:
  -- получатель сверяет с тем же файлом, из которого мы его взяли.
  raw_code      text not null,
  gtin          text,
  serial        text,
  cabinet_id    uuid,
  -- Номер сборочного задания: по нему код находится в кабинете WB.
  task_id       text,
  nm_id         bigint,
  article       text,
  barcode       text,
  -- Цена реализации из выгрузки завершённых заказов.
  price         numeric(14, 2),
  sold_at       date,
  status        text not null default 'sold'
                check (status in ('sold', 'returned', 'sent', 'returned_after_sent')),
  returned_at   date,
  return_reason text,
  -- Партия отправки: один файл — одна партия, чтобы можно было понять,
  -- в каком именно письме уехал конкретный код.
  batch_id      uuid,
  sent_at       timestamptz,
  -- Имя файла и период, из которых строка пришла: для разбора спорных случаев.
  source        text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.kiz_withdrawals is
  'Коды маркировки, проданные по FBS: что выведено из оборота, что вернулось, что ждёт отправки.';

create index if not exists kiz_withdrawals_status_idx
  on public.kiz_withdrawals (status, sold_at);
create index if not exists kiz_withdrawals_batch_idx
  on public.kiz_withdrawals (batch_id);
create index if not exists kiz_withdrawals_cabinet_idx
  on public.kiz_withdrawals (cabinet_id, sold_at desc);

alter table public.kiz_withdrawals enable row level security;
revoke all on public.kiz_withdrawals from anon, authenticated;

notify pgrst, 'reload schema';
