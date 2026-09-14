-- Справочник поставщиков (ТЗ §4.2) — первый шаг закупочного контура.
--
-- Сегодня поставщик на заказе фабрике — просто текстовая строка (purchase_orders.supplier).
-- Дважды написать «Guangzhou Feiyang» и «guangzhou feiyang» — два разных поставщика для
-- системы, а баланс (сколько должны мы, сколько должны нам) посчитать не из чего: она
-- не собрана ни в одном месте, кроме этапов оплаты одного заказа.
--
-- Поставщик — общий справочник компании, не привязан к юрлицу или кабинету: одна фабрика
-- в Гуанчжоу шьёт куртки на несколько наших юрлиц сразу. Кому именно и на каких условиях —
-- вопрос договора (следующий шаг), не самого поставщика.

create table if not exists public.suppliers (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  country           text,
  tax_id            text,
  -- Основная валюта расчётов. У заказа фабрике своя валюта уже есть (purchase_orders.currency) —
  -- эта же используется только как значение по умолчанию при создании нового заказа.
  currency          text not null default 'CNY' check (currency in ('CNY', 'RUB', 'USD')),
  production_days   integer not null default 0 check (production_days >= 0 and production_days <= 365),
  min_order_qty     integer check (min_order_qty is null or min_order_qty >= 0),
  contact_name      text,
  contact_phone     text,
  note              text,
  -- Не хард-делит: у поставщика могут быть закрытые заказы в истории, а
  -- purchase_orders.supplier_id на них ссылается. Выключенный просто не
  -- предлагается при создании нового заказа — тот же приём, что у products.is_active.
  is_active         boolean not null default true,
  created_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index if not exists suppliers_name_unique
  on public.suppliers (lower(name));
create index if not exists suppliers_active_idx
  on public.suppliers (is_active, name);

comment on table public.suppliers is
  'Справочник поставщиков фабрики. Общий на компанию — не по юрлицу и не по кабинету.';

alter table public.purchase_orders
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;

create index if not exists purchase_orders_supplier_idx
  on public.purchase_orders (supplier_id);

comment on column public.purchase_orders.supplier_id is
  'Ссылка на suppliers. Текстовое поле supplier остаётся источником отображаемого имени
   ради обратной совместимости со старыми заказами — supplier_id заполняется отдельно,
   привязкой в интерфейсе, а не автоматической миграцией текста.';

alter table public.suppliers enable row level security;
revoke all on public.suppliers from anon, authenticated;

notify pgrst, 'reload schema';
