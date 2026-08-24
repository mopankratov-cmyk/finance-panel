-- Продажи FBS списывают склад — ЧАСТЬ 1 из 2: только схема.
--
-- Процедурная часть вынесена в отдельный файл 202608240020 намеренно. Редактор
-- Supabase, увидев в скрипте `create table`, дописывает к нему включение RLS —
-- и вставляет эти ALTER TABLE ВНУТРЬ тела соседней plpgsql-процедуры, принимая
-- её локальные переменные за новые таблицы. Скрипт обрывается на
-- «unterminated dollar-quoted string», и не применяется НИЧЕГО, включая саму
-- таблицу. Именованные долларовые кавычки от этого не спасают — спасает
-- разделение схемы и кода по разным файлам.
--
-- ПРОВЕРКА ПЕРЕД ЗАПУСКОМ: в этом файле 47 строк и НЕТ слов «declare» и
-- «$» с именем. Если видишь их в редакторе — там открыт старый текст.
--
-- Смысл изменения: до сих пор в регистр движений не писал никто, кроме модуля
-- склада. Для FBW это верно — товар ушёл в момент отгрузки на склад
-- маркетплейса. Но при FBS он физически остаётся на фулфилменте и продаётся
-- оттуда, а регистр об этом не узнавал никогда: остаток на ФФ не уменьшался ни
-- на одну штуку.

alter table public.stock_moves
  drop constraint if exists stock_moves_kind_check;
alter table public.stock_moves
  add constraint stock_moves_kind_check
  check (kind in ('receipt', 'shipment', 'writeoff', 'return', 'adjustment', 'transfer', 'sale'));

-- Настройка живёт на паре «юрлицо + склад»: склад общий, а доверять его остатку
-- каждое юрлицо начинает со своей даты — со своей приёмки или инвентаризации.
create table if not exists public.legal_entity_warehouses (
  legal_entity_id uuid not null references public.legal_entities(id) on delete cascade,
  warehouse_id    uuid not null references public.warehouses(id) on delete cascade,
  -- null — списание продаж выключено. Дата — с неё считаем продажи FBS.
  fbs_sales_since timestamptz,
  fbs_synced_at   timestamptz,
  updated_at      timestamptz not null default now(),
  primary key (legal_entity_id, warehouse_id)
);

comment on table public.legal_entity_warehouses is
  'Настройки пары «юрлицо + склад»: с какой даты продажи FBS списывают этот склад.';

alter table public.legal_entity_warehouses enable row level security;
revoke all on public.legal_entity_warehouses from anon, authenticated;

-- Один заказ — одно движение. Повторный запуск синхронизации не должен списать
-- ту же продажу второй раз, а запусков будет много: это фоновая работа.
create unique index if not exists stock_moves_fbs_sale_unique
  on public.stock_moves (doc_id)
  where doc_type = 'fbs_sale';

notify pgrst, 'reload schema';
