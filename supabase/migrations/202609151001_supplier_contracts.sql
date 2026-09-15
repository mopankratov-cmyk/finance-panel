-- §27.11 ТЗ: момент перехода права собственности задаётся по договору.
-- §4.3 ТЗ: договоры и спецификации — отдельная сущность, названная ещё в
-- Фазе 0 этого плана (задача 0.2), но не реализованная тогда — построен был
-- только справочник поставщиков (202609140003_suppliers.sql). Комментарий в
-- той же миграции и в app/api/suppliers/route.ts прямо называет договор
-- «следующим шагом»: «кому именно и на каких условиях — вопрос договора».
--
-- Договор — пара (поставщик, юрлицо): один поставщик может шить на несколько
-- наших юрлиц одновременно, каждое со своими условиями и моментом перехода
-- права. purchase_orders своего legal_entity_id не хранит — юрлицо заказа
-- выводится через cabinet_id → legal_entity_cabinets, тем же путём, каким
-- уже пользуется post_receipt_batch().

create table if not exists public.supplier_contracts (
  id                        uuid primary key default gen_random_uuid(),
  supplier_id               uuid not null references public.suppliers(id) on delete cascade,
  legal_entity_id           uuid not null references public.legal_entities(id) on delete restrict,
  number                    text not null,
  signed_at                 date,
  currency                  text not null default 'CNY' check (currency in ('CNY', 'RUB', 'USD')),
  prepayment_percent        numeric(6, 2) check (prepayment_percent is null or (prepayment_percent >= 0 and prepayment_percent <= 100)),
  prepayment_terms          text,
  final_payment_terms       text,
  production_days           integer check (production_days is null or (production_days >= 0 and production_days <= 365)),
  -- Стадии — по лестнице supplier_shipments.status (lib/purchases/shipments.ts):
  -- planned → shipped → customs → arrived → received. 'other' — момент, который
  -- эта лестница не описывает (нет однозначного правила для бейджа на экране
  -- «Товар в пути», человек читает ownership_transfer_note своими глазами).
  ownership_transfer_moment text not null default 'after_customs'
    check (ownership_transfer_moment in ('after_supplier_shipment', 'after_carrier', 'after_customs', 'after_warehouse_receipt', 'other')),
  ownership_transfer_note   text,
  country_of_origin         text,
  delivery_terms            text,
  transport_terms           text,
  customs_terms             text,
  is_active                 boolean not null default true,
  note                      text,
  created_by                text,
  updated_by                text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- «Какой договор действует для этой пары» — основной запрос резолвинга
-- бейджа на «Товар в пути»; is_active первым в индексе отсекает архивные
-- договоры до сортировки по дате подписания.
create index if not exists supplier_contracts_lookup_idx
  on public.supplier_contracts (supplier_id, legal_entity_id, is_active, signed_at desc);

comment on table public.supplier_contracts is
  'Договор с поставщиком на конкретное юрлицо (§4.3, §27.11 ТЗ). Один поставщик
   может иметь несколько договоров — по одному на юрлицо, либо несколько
   активных сразу при переподписании: резолвинг берёт самый свежий по
   signed_at среди is_active=true.';
comment on column public.supplier_contracts.ownership_transfer_moment is
  'Момент, с которого отгруженный товар становится активом компании, а не
   просто заказанным. Сопоставляется со статусом supplier_shipments на чтении,
   в саму отгрузку не пишется — снимок не нужен, т.к. бейдж не хранится.';

alter table public.supplier_contracts enable row level security;
revoke all on public.supplier_contracts from anon, authenticated;

notify pgrst, 'reload schema';
