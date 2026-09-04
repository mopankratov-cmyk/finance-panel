-- Движение товаров по ТЗ команды (28.08.2026) — ЧАСТЬ 1 из 2: только схема.
--
-- В этом файле НЕТ ни одной функции: редактор Supabase, увидев `create table`,
-- дописывает включение RLS и промахивается прямо в тело соседней plpgsql-процедуры,
-- принимая её локальные переменные за таблицы. Процедуры — в 202609040003.
--
-- Что добавляется и зачем:
--
-- 1. Модель и цвет у товара. Склад по ТЗ показывает иерархию «модель → цвет →
--    размер». Источник — карточка WB (решение владельца): карточки одной модели
--    в разных цветах объединены у WB общим imtID, цвет лежит в характеристике
--    «Цвет». Артикул (NV-836-02) — запасной способ для товара без карточки.
--    Поля правятся руками.
--
-- 2. Признак «новинка»: товар, которым раньше не торговали. Ставится при первой
--    приёмке и нужен процедуре запуска новинки (РНП), которую опишут позже.
--
-- 3. Шапка партии приёмки. Строки партии живут в purchase_receipts (общая таблица
--    с разделом «Поставки»), а поставщик, номер, число мешков и отметка «кто и
--    когда пересчитал» — на партию, а не на строку. Чужую таблицу не раздуваем.
--
-- 4. Задание на отгрузку. По ТЗ отгрузка идёт в два шага: администратор ставит
--    задание фулфилменту, товар с этого момента «размещён, но не отгружен», а
--    списание происходит, когда ФФ нажимает «Отгружено». Задание — это документ
--    в stock_docs со статусом draft и строками в stock_doc_lines. Регистр при
--    этом не трогается: резерв считается из черновиков, остаток списывает
--    проводка при подтверждении. Так append-only регистр остаётся правдой о том,
--    что физически произошло.
--
-- 5. События склада. ТЗ просит ленту «создана приёмка №, пересчитана, создано
--    задание, отгружено, создан брак, расхождение, коррекция» с датой и
--    пользователем, и журнал правок по пользователям. Регистр движений этого не
--    даёт: у него нет «пересчитал», «создал задание», «скорректировал». Отдельная
--    append-only таблица, пишется из API-роутов рядом с операцией.

-- ---------------------------------------------------------------------------
-- 1–2. Товар: модель, цвет, новинка
-- ---------------------------------------------------------------------------

alter table public.products add column if not exists model text;
alter table public.products add column if not exists color text;
-- imtID карточки WB: цвета одной модели у WB объединены им. Группировка идёт
-- по нему, подпись модели — текстом рядом.
alter table public.products add column if not exists imt_id bigint;
alter table public.products add column if not exists is_novelty boolean not null default false;

create index if not exists products_model_idx
  on public.products (model) where model is not null;
create index if not exists products_imt_idx
  on public.products (imt_id) where imt_id is not null;

-- products_view создана с явным перечнем колонок (см. 202608230011): новая колонка
-- сама в представление не попадает — пересоздаём.
drop view if exists public.products_view;

create view public.products_view as
select
  p.id, p.legal_entity_id, p.article, p.name, p.barcode, p.category, p.brand, p.nm_id,
  p.photo_url, p.factory_price, p.factory_currency, p.weight_kg,
  p.length_cm, p.width_cm, p.height_cm, p.min_stock, p.season,
  p.is_active, p.note, p.created_by, p.created_at, p.updated_at,
  p.model, p.color, p.imt_id, p.is_novelty,
  case
    when p.length_cm is not null and p.width_cm is not null and p.height_cm is not null
      then round((p.length_cm * p.width_cm * p.height_cm) / 1000.0, 3)
    else null
  end as volume_liters
from public.products p;

revoke all on public.products_view from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Шапка партии приёмки
-- ---------------------------------------------------------------------------

create table if not exists public.stock_receipt_batches (
  -- Тот же batch_id, что у строк в purchase_receipts.
  batch_id        uuid primary key,
  legal_entity_id uuid not null references public.legal_entities(id) on delete cascade,
  -- Человеческий номер ПРМ-2026-0001: им ссылаются в переписке с фулфилментом.
  number          text unique,
  supplier        text,
  bags_count      integer check (bags_count is null or bags_count >= 0),
  -- Кто и когда пересчитал партию. Длительность пересчёта не вводится руками:
  -- при необходимости она считается как counted_at − created_at.
  counted_at      timestamptz,
  counted_by      text,
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.stock_receipt_batches is
  'Шапка партии приёмки: номер, поставщик, мешки, отметка пересчёта. Строки — в purchase_receipts.';

create index if not exists stock_receipt_batches_entity_idx
  on public.stock_receipt_batches (legal_entity_id, created_at desc);

alter table public.stock_receipt_batches enable row level security;
revoke all on public.stock_receipt_batches from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Задание на отгрузку: документ-черновик со строками
-- ---------------------------------------------------------------------------

-- Кто и когда подтвердил отгрузку. Время выполнения задания — это
-- confirmed_at − created_at, отдельного ввода минут нет.
alter table public.stock_docs add column if not exists confirmed_at timestamptz;
alter table public.stock_docs add column if not exists confirmed_by text;

-- Отменённое задание остаётся в журнале с номером: «куда делось ОТГ-2026-0007»
-- должно иметь ответ.
alter table public.stock_docs drop constraint if exists stock_docs_status_check;
alter table public.stock_docs
  add constraint stock_docs_status_check
  check (status in ('draft', 'posted', 'reversed', 'cancelled'));

-- Коррекция прихода — свой вид документа: она правит остаток, но не является
-- ни приёмкой, ни списанием.
alter table public.stock_docs drop constraint if exists stock_docs_kind_check;
alter table public.stock_docs
  add constraint stock_docs_kind_check
  check (kind in ('shipment', 'transfer', 'writeoff', 'return', 'receipt', 'adjustment'));

create index if not exists stock_docs_draft_idx
  on public.stock_docs (legal_entity_id, status)
  where status = 'draft';

create table if not exists public.stock_doc_lines (
  id          bigint generated always as identity primary key,
  doc_id      uuid not null references public.stock_docs(id) on delete cascade,
  variant_id  uuid not null references public.product_variants(id) on delete restrict,
  product_id  uuid not null references public.products(id) on delete restrict,
  cabinet_id  uuid,
  -- Сколько поставлено в задание.
  qty         integer not null check (qty > 0),
  -- Сколько фактически отгружено при подтверждении; null — задание ещё не выполнено.
  shipped_qty integer check (shipped_qty is null or shipped_qty >= 0),
  created_at  timestamptz not null default now()
);

comment on table public.stock_doc_lines is
  'Строки задания на отгрузку. Пока документ draft — это резерв, после подтверждения — то, что уехало.';

create unique index if not exists stock_doc_lines_doc_variant_unique
  on public.stock_doc_lines (doc_id, variant_id);
create index if not exists stock_doc_lines_variant_idx
  on public.stock_doc_lines (variant_id);

alter table public.stock_doc_lines enable row level security;
revoke all on public.stock_doc_lines from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. События склада
-- ---------------------------------------------------------------------------

create table if not exists public.warehouse_events (
  id              bigint generated always as identity primary key,
  legal_entity_id uuid not null references public.legal_entities(id) on delete cascade,
  -- Машинный код события (receipt_created, task_shipped, …); русские подписи
  -- живут в lib/warehouse/events.ts — в базе человеческого текста нет.
  kind            text not null,
  -- На что ссылается: receipt_batch / stock_doc / product и его идентификатор.
  ref_type        text,
  ref_id          text,
  -- Человеческий номер документа или партии, чтобы лента читалась без переходов.
  number          text,
  warehouse_id    uuid references public.warehouses(id) on delete set null,
  actor           text,
  actor_role      text,
  occurred_at     timestamptz not null default now(),
  -- Что именно произошло: количества, склад, кабинет — как есть.
  payload         jsonb,
  -- Для правок: {before, after} по полям. Журнал изменений строится отсюда.
  changes         jsonb,
  created_at      timestamptz not null default now()
);

comment on table public.warehouse_events is
  'Лента событий склада: кто, когда, что сделал. Только вставка — правки запрещены триггером (см. часть 2).';

create index if not exists warehouse_events_entity_idx
  on public.warehouse_events (legal_entity_id, occurred_at desc);
create index if not exists warehouse_events_actor_idx
  on public.warehouse_events (actor, occurred_at desc);
create index if not exists warehouse_events_ref_idx
  on public.warehouse_events (ref_type, ref_id);

alter table public.warehouse_events enable row level security;
revoke all on public.warehouse_events from anon, authenticated;

notify pgrst, 'reload schema';
