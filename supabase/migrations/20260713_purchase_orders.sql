-- P0.6 «Заказ фабрике»: ручной операционный контур без автоматических платежей
-- и без изменения финансового блока. Сохранение заказа и дочерних строк идёт
-- через одну PL/pgSQL-функцию, поэтому autosave не оставляет половину документа.

create table if not exists public.purchase_orders (
  id                  uuid primary key default gen_random_uuid(),
  cabinet_id          uuid not null references public.wb_cabinets(id) on delete restrict,
  order_number        text not null,
  supplier            text not null default '',
  order_date          date not null default current_date,
  production_days     integer not null default 0 check (production_days >= 0 and production_days <= 365),
  expected_ready_date date,
  currency            text not null default 'CNY' check (currency in ('CNY', 'RUB', 'USD')),
  exchange_rate       numeric(14, 4) not null default 1 check (exchange_rate > 0),
  status              text not null default 'draft' check (status in ('draft', 'placed', 'production', 'transit', 'received', 'cancelled')),
  note                text,
  receipt_batch_id    uuid,
  idempotency_key     text unique,
  created_by          text,
  updated_by          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (cabinet_id, order_number)
);

create table if not exists public.purchase_order_items (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references public.purchase_orders(id) on delete cascade,
  nm_id       bigint not null,
  article     text not null default '',
  name        text not null default '',
  quantity    integer not null check (quantity > 0),
  unit_price  numeric(14, 4) not null default 0 check (unit_price >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (order_id, nm_id)
);

create table if not exists public.purchase_payment_stages (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references public.purchase_orders(id) on delete cascade,
  title       text not null,
  percent     numeric(6, 2) not null default 0 check (percent >= 0 and percent <= 100),
  amount      numeric(14, 2) not null default 0 check (amount >= 0),
  due_date    date,
  paid_at     timestamptz,
  status      text not null default 'planned' check (status in ('planned', 'paid', 'cancelled')),
  position    integer not null default 0
);

create table if not exists public.purchase_logistics_stages (
  id            bigint generated always as identity primary key,
  order_id      uuid not null references public.purchase_orders(id) on delete cascade,
  title         text not null,
  provider      text not null default '',
  due_date      date,
  completed_at  timestamptz,
  cost          numeric(14, 2) not null default 0 check (cost >= 0),
  status        text not null default 'planned' check (status in ('planned', 'in_progress', 'done', 'cancelled')),
  position      integer not null default 0
);

create table if not exists public.purchase_expenses (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references public.purchase_orders(id) on delete cascade,
  title       text not null,
  amount      numeric(14, 2) not null default 0 check (amount >= 0),
  currency    text not null default 'RUB' check (currency in ('CNY', 'RUB', 'USD')),
  position    integer not null default 0
);

create table if not exists public.operation_audit_log (
  id              bigint generated always as identity primary key,
  cabinet_id      uuid not null references public.wb_cabinets(id) on delete restrict,
  entity_type     text not null,
  entity_id       uuid not null,
  action          text not null,
  actor           text,
  idempotency_key text,
  before_data     jsonb,
  after_data      jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists purchase_orders_cabinet_status_idx on public.purchase_orders (cabinet_id, status, updated_at desc);
create index if not exists purchase_order_items_order_idx on public.purchase_order_items (order_id);
create index if not exists purchase_payment_stages_order_idx on public.purchase_payment_stages (order_id, position);
create index if not exists purchase_logistics_stages_order_idx on public.purchase_logistics_stages (order_id, position);
create index if not exists purchase_expenses_order_idx on public.purchase_expenses (order_id, position);
create index if not exists operation_audit_entity_idx on public.operation_audit_log (entity_type, entity_id, created_at desc);

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.purchase_payment_stages enable row level security;
alter table public.purchase_logistics_stages enable row level security;
alter table public.purchase_expenses enable row level security;
alter table public.operation_audit_log enable row level security;

-- Эти таблицы доступны только через серверные API с проверкой сессии/кабинета.
-- service_role обходит RLS, а браузерные anon/authenticated роли не получают
-- прямого доступа к документам и журналу операций.
revoke all on table public.purchase_orders from anon, authenticated;
revoke all on table public.purchase_order_items from anon, authenticated;
revoke all on table public.purchase_payment_stages from anon, authenticated;
revoke all on table public.purchase_logistics_stages from anon, authenticated;
revoke all on table public.purchase_expenses from anon, authenticated;
revoke all on table public.operation_audit_log from anon, authenticated;

create or replace function public.save_purchase_order(p_order jsonb, p_actor text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_existing_id uuid;
  v_cabinet_id uuid;
  v_order_number text;
  v_status text;
  v_idempotency_key text;
  v_before jsonb;
  v_after jsonb;
begin
  v_cabinet_id := nullif(p_order->>'cabinetId', '')::uuid;
  v_order_number := trim(coalesce(p_order->>'orderNumber', ''));
  v_status := coalesce(nullif(p_order->>'status', ''), 'draft');
  v_idempotency_key := nullif(p_order->>'idempotencyKey', '');

  if v_cabinet_id is null then raise exception 'cabinetId is required'; end if;
  if v_order_number = '' then raise exception 'orderNumber is required'; end if;
  if v_status not in ('draft', 'placed', 'production', 'transit', 'received', 'cancelled') then
    raise exception 'invalid purchase order status';
  end if;

  -- Повтор create с тем же ключом возвращает уже созданный документ без второго audit event.
  if nullif(p_order->>'id', '') is null and v_idempotency_key is not null then
    select id into v_existing_id from public.purchase_orders where idempotency_key = v_idempotency_key;
    if v_existing_id is not null then return v_existing_id; end if;
  end if;

  v_id := coalesce(nullif(p_order->>'id', '')::uuid, gen_random_uuid());
  select to_jsonb(po) into v_before from public.purchase_orders po where po.id = v_id;

  if v_before is null then
    insert into public.purchase_orders (
      id, cabinet_id, order_number, supplier, order_date, production_days,
      expected_ready_date, currency, exchange_rate, status, note,
      idempotency_key, created_by, updated_by
    ) values (
      v_id,
      v_cabinet_id,
      v_order_number,
      trim(coalesce(p_order->>'supplier', '')),
      coalesce(nullif(p_order->>'orderDate', '')::date, current_date),
      greatest(0, least(365, coalesce((p_order->>'productionDays')::integer, 0))),
      nullif(p_order->>'expectedReadyDate', '')::date,
      coalesce(nullif(p_order->>'currency', ''), 'CNY'),
      greatest(0.0001, coalesce((p_order->>'exchangeRate')::numeric, 1)),
      v_status,
      nullif(p_order->>'note', ''),
      v_idempotency_key,
      p_actor,
      p_actor
    );
  else
    if (v_before->>'cabinet_id')::uuid <> v_cabinet_id then
      raise exception 'cabinet cannot be changed';
    end if;
    update public.purchase_orders set
      order_number = v_order_number,
      supplier = trim(coalesce(p_order->>'supplier', '')),
      order_date = coalesce(nullif(p_order->>'orderDate', '')::date, current_date),
      production_days = greatest(0, least(365, coalesce((p_order->>'productionDays')::integer, 0))),
      expected_ready_date = nullif(p_order->>'expectedReadyDate', '')::date,
      currency = coalesce(nullif(p_order->>'currency', ''), 'CNY'),
      exchange_rate = greatest(0.0001, coalesce((p_order->>'exchangeRate')::numeric, 1)),
      status = v_status,
      note = nullif(p_order->>'note', ''),
      updated_by = p_actor,
      updated_at = now()
    where id = v_id;
  end if;

  delete from public.purchase_order_items where order_id = v_id;
  insert into public.purchase_order_items (order_id, nm_id, article, name, quantity, unit_price)
  select
    v_id,
    (item->>'nmId')::bigint,
    trim(coalesce(item->>'article', '')),
    trim(coalesce(item->>'name', '')),
    greatest(1, (item->>'quantity')::integer),
    greatest(0, coalesce((item->>'unitPrice')::numeric, 0))
  from jsonb_array_elements(coalesce(p_order->'items', '[]'::jsonb)) item;

  delete from public.purchase_payment_stages where order_id = v_id;
  insert into public.purchase_payment_stages (order_id, title, percent, amount, due_date, paid_at, status, position)
  select
    v_id,
    trim(stage->>'title'),
    greatest(0, least(100, coalesce((stage->>'percent')::numeric, 0))),
    greatest(0, coalesce((stage->>'amount')::numeric, 0)),
    nullif(stage->>'dueDate', '')::date,
    nullif(stage->>'paidAt', '')::timestamptz,
    coalesce(nullif(stage->>'status', ''), 'planned'),
    ordinality - 1
  from jsonb_array_elements(coalesce(p_order->'paymentStages', '[]'::jsonb)) with ordinality as stages(stage, ordinality)
  where trim(coalesce(stage->>'title', '')) <> '';

  delete from public.purchase_logistics_stages where order_id = v_id;
  insert into public.purchase_logistics_stages (order_id, title, provider, due_date, completed_at, cost, status, position)
  select
    v_id,
    trim(stage->>'title'),
    trim(coalesce(stage->>'provider', '')),
    nullif(stage->>'dueDate', '')::date,
    nullif(stage->>'completedAt', '')::timestamptz,
    greatest(0, coalesce((stage->>'cost')::numeric, 0)),
    coalesce(nullif(stage->>'status', ''), 'planned'),
    ordinality - 1
  from jsonb_array_elements(coalesce(p_order->'logisticsStages', '[]'::jsonb)) with ordinality as stages(stage, ordinality)
  where trim(coalesce(stage->>'title', '')) <> '';

  delete from public.purchase_expenses where order_id = v_id;
  insert into public.purchase_expenses (order_id, title, amount, currency, position)
  select
    v_id,
    trim(expense->>'title'),
    greatest(0, coalesce((expense->>'amount')::numeric, 0)),
    coalesce(nullif(expense->>'currency', ''), 'RUB'),
    ordinality - 1
  from jsonb_array_elements(coalesce(p_order->'expenses', '[]'::jsonb)) with ordinality as expenses(expense, ordinality)
  where trim(coalesce(expense->>'title', '')) <> '';

  select to_jsonb(po) into v_after from public.purchase_orders po where po.id = v_id;
  insert into public.operation_audit_log (
    cabinet_id, entity_type, entity_id, action, actor, idempotency_key, before_data, after_data
  ) values (
    v_cabinet_id,
    'purchase_order',
    v_id,
    case when v_before is null then 'created' else 'updated' end,
    p_actor,
    v_idempotency_key,
    v_before,
    v_after || jsonb_build_object(
      'items', coalesce(p_order->'items', '[]'::jsonb),
      'paymentStages', coalesce(p_order->'paymentStages', '[]'::jsonb),
      'logisticsStages', coalesce(p_order->'logisticsStages', '[]'::jsonb),
      'expenses', coalesce(p_order->'expenses', '[]'::jsonb)
    )
  );

  return v_id;
end;
$$;

revoke all on function public.save_purchase_order(jsonb, text) from public;
grant execute on function public.save_purchase_order(jsonb, text) to service_role;

-- Один заказ можно передать в существующий контур приёмки только один раз.
-- Блокировка строки и сохранённый batch_id делают действие идемпотентным даже
-- при двойном клике или повторе запроса после сетевой ошибки.
create or replace function public.create_purchase_order_receipt(p_order_id uuid, p_actor text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.purchase_orders%rowtype;
  v_batch_id uuid;
  v_item_count integer;
begin
  select * into v_order from public.purchase_orders where id = p_order_id for update;
  if not found then raise exception 'purchase order not found'; end if;
  if v_order.receipt_batch_id is not null then return v_order.receipt_batch_id; end if;
  if v_order.status in ('draft', 'cancelled', 'received') then raise exception 'purchase order status cannot be sent to receiving'; end if;

  select count(*) into v_item_count from public.purchase_order_items where order_id = p_order_id;
  if v_item_count = 0 then raise exception 'purchase order has no items'; end if;

  v_batch_id := gen_random_uuid();
  insert into public.purchase_receipts (
    batch_id, cabinet_id, nm_id, article, expected_qty, expected_at,
    status, source, note, created_by
  )
  select
    v_batch_id,
    v_order.cabinet_id,
    item.nm_id,
    item.article,
    item.quantity,
    v_order.expected_ready_date,
    'expected',
    'manual',
    'Заказ фабрике ' || v_order.order_number,
    p_actor
  from public.purchase_order_items item
  where item.order_id = p_order_id;

  update public.purchase_orders
  set receipt_batch_id = v_batch_id, status = 'transit', updated_by = p_actor, updated_at = now()
  where id = p_order_id;

  insert into public.operation_audit_log (
    cabinet_id, entity_type, entity_id, action, actor, after_data
  ) values (
    v_order.cabinet_id,
    'purchase_order',
    p_order_id,
    'receiving_created',
    p_actor,
    jsonb_build_object('receiptBatchId', v_batch_id, 'status', 'transit')
  );

  return v_batch_id;
end;
$$;

revoke all on function public.create_purchase_order_receipt(uuid, text) from public;
grant execute on function public.create_purchase_order_receipt(uuid, text) to service_role;

-- Когда существующая приёмка закрыла последнюю ожидаемую строку batch,
-- заказ автоматически завершает цикл. Остатки WB по-прежнему приходят из WB API:
-- ручной факт приёмки не подменяет marketplace-источник истины.
create or replace function public.sync_purchase_order_received_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_cabinet_id uuid;
begin
  if new.status <> 'received' or old.status = 'received' then return new; end if;
  if exists (select 1 from public.purchase_receipts where batch_id = new.batch_id and status = 'expected') then return new; end if;

  update public.purchase_orders
  set status = 'received', updated_by = 'receiving', updated_at = now()
  where receipt_batch_id = new.batch_id and status <> 'received'
  returning id, cabinet_id into v_order_id, v_cabinet_id;

  if v_order_id is not null then
    insert into public.operation_audit_log (
      cabinet_id, entity_type, entity_id, action, actor, after_data
    ) values (
      v_cabinet_id,
      'purchase_order',
      v_order_id,
      'received',
      'receiving',
      jsonb_build_object('receiptBatchId', new.batch_id, 'status', 'received')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists purchase_order_receipt_status_trigger on public.purchase_receipts;
create trigger purchase_order_receipt_status_trigger
after update of status on public.purchase_receipts
for each row execute function public.sync_purchase_order_received_status();

revoke all on function public.sync_purchase_order_received_status() from public;
