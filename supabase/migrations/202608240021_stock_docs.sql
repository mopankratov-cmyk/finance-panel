-- Документ склада — ЧАСТЬ 1 из 2: только схема.
--
-- (Процедурная часть в 202608240022. Разделение обязательное: редактор Supabase,
-- увидев `create table`, дописывает включение RLS и вставляет его внутрь тела
-- соседней plpgsql-процедуры, приняв её локальные переменные за таблицы —
-- скрипт обрывается, и не применяется ничего.)
--
-- Зачем. Регистр движений у нас есть, а документа нет: функции проведения
-- рассыпают операцию в строки stock_moves и возвращают безымянный uuid. Отсюда
-- три следствия, каждое из которых мешает работать со сторонним фулфилментом:
-- сослаться в переписке не на что («та отгрузка от вторника»), увидеть
-- проведённое одним списком нельзя, а ошибку исправить нечем — регистр
-- append-only, и правка в нём запрещена триггером.
--
-- Документ ничего не меняет в механике проведения. Он её ЗАПОМИНАЕТ: номер,
-- дату, автора, итог и ссылку на движения. А сторно — не удаление, а обратные
-- движения со ссылкой на исходный документ: единственная операция отмены,
-- которую append-only регистр вообще допускает.

create table if not exists public.stock_docs (
  id              uuid primary key default gen_random_uuid(),
  -- Человеческий номер: ОТГ-2026-0001. Им ссылаются в чате с фулфилментом.
  number          text not null unique,
  kind            text not null check (kind in ('shipment', 'transfer', 'writeoff', 'return', 'receipt')),
  status          text not null default 'posted' check (status in ('draft', 'posted', 'reversed')),
  legal_entity_id uuid not null references public.legal_entities(id) on delete cascade,
  warehouse_id    uuid references public.warehouses(id),
  -- Склад назначения перемещения.
  target_warehouse_id uuid references public.warehouses(id),
  -- Кабинет возврата: канал, из которого товар приехал обратно.
  cabinet_id      uuid,
  occurred_at     timestamptz not null default now(),
  note            text,
  -- Идентификатор, под которым проводка записала движения в регистр. По нему
  -- документ находит свои строки и по нему же строится сторно.
  movement_doc_id text,
  -- Итог проводки как его вернула функция: количество, сумма, состав.
  result          jsonb,
  -- Сторнирующий документ и, наоборот, документ-основание сторно.
  reversed_by     uuid references public.stock_docs(id),
  reverses        uuid references public.stock_docs(id),
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.stock_docs is
  'Складские документы: номер, дата, автор и связь с движениями регистра.';

create index if not exists stock_docs_entity_idx
  on public.stock_docs (legal_entity_id, occurred_at desc);
create index if not exists stock_docs_movement_idx
  on public.stock_docs (movement_doc_id);

alter table public.stock_docs enable row level security;
revoke all on public.stock_docs from anon, authenticated;

-- Счётчик номеров: по виду документа и году, чтобы номер был коротким и
-- человеческим, а не сквозным на все годы сразу.
create table if not exists public.stock_doc_counters (
  kind  text not null,
  year  integer not null,
  last  integer not null default 0,
  primary key (kind, year)
);

alter table public.stock_doc_counters enable row level security;
revoke all on public.stock_doc_counters from anon, authenticated;

-- Сторно — тоже движения, и им нужен свой вид документа в регистре.
-- (Виды движений не трогаем: сторно повторяет вид исходного движения со знаком
-- минус, меняется только doc_type.)

notify pgrst, 'reload schema';
