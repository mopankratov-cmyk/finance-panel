-- «Разработка ассортимента», этап 2: автообход каталогов Shopify-брендов.
--
-- ТЗ: «Первая загрузка формирует базу сравнения и не объявляет весь каталог
-- новинками». Для этого нужен список уже виденных товаров каждого источника:
-- первый обход кладёт сюда весь каталог с baseline = true и в ленту ничего не
-- пишет; дальше в ленту попадают только товары, которых раньше не было.
-- Новые товары без reference_id — очередь: обработаются следующим прогоном.
--
-- Цен здесь нет и не будет (граница ТЗ): только идентификаторы, название,
-- тип и даты.

create table if not exists public.assortment_source_items (
  source_id        text not null references public.assortment_sources(source_id),
  source_item_id   text not null,
  handle           text,
  title            text,
  product_type     text,
  direction        text check (direction in ('jackets', 'bags')),
  published_at     timestamptz,
  baseline         boolean not null default false,
  reference_id     uuid references public.assortment_references(id) on delete set null,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  primary key (source_id, source_item_id)
);

create index if not exists assortment_source_items_queue_idx
  on public.assortment_source_items (source_id)
  where baseline = false and reference_id is null and direction is not null;

alter table public.assortment_source_items enable row level security;
revoke all on public.assortment_source_items from anon, authenticated;

-- Пульс обхода: «ничего нового» и «источник не ответил» — разные вещи (ТЗ §10).
alter table public.assortment_sources
  add column if not exists last_attempt_at timestamptz,
  add column if not exists last_error text;
