-- Модуль «Склад»: собственный регистр движений товара.
--
-- До этой миграции остаток существовал только как цифра маркетплейса: WB отдаёт
-- `stock` и `in_way_to_client`, а товар, который физически приехал на свой склад или
-- к фулфилменту, учитывать было негде — `purchase_receipts` писала строку в лог и ни
-- на что не влияла. Здесь появляется недостающая середина.
--
-- Главное решение: остаток и себестоимость НЕ хранятся как числа, которые кто-то
-- обновляет. Хранятся движения (`stock_moves`, только вставка), а остаток — их сумма,
-- себестоимость — взвешенное среднее (view `stock_balances`). Поэтому два экрана не
-- могут показать разное: пересчитывать нечего.
--
-- Остаток WB при этом остаётся источником истины по маркетплейсу и сюда НЕ переносится:
-- склад маркетплейса живёт в WB API, наш регистр знает только свои склады и склады
-- фулфилмента. Расхождение с WB — сигнал к разбирательству, а не повод переписать факт.

-- ---------------------------------------------------------------------------
-- 1. Склады
-- ---------------------------------------------------------------------------
-- Склад принадлежит кабинету, как и всё остальное в репозитории: доступ везде
-- проверяется через hasCabinetAccess(cabinet_id), и склад без кабинета выпал бы из
-- этой модели. Физически общий склад (один Уссурийск на два кабинета) заводится
-- строкой в каждом кабинете — это осознанное упрощение первого этапа.

create table if not exists public.warehouses (
  id          uuid primary key default gen_random_uuid(),
  cabinet_id  uuid not null references public.wb_cabinets(id) on delete cascade,
  name        text not null,
  kind        text not null default 'own' check (kind in ('own', 'fulfillment')),
  is_active   boolean not null default true,
  position    integer not null default 0,
  note        text,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists warehouses_cabinet_name_unique
  on public.warehouses (cabinet_id, lower(name));
create index if not exists warehouses_cabinet_idx
  on public.warehouses (cabinet_id, is_active, position);

-- ---------------------------------------------------------------------------
-- 2. Партия — единица себестоимости
-- ---------------------------------------------------------------------------
-- Партия отвечает на вопрос «во что обошёлся этот приход»: товар по цене фабрики
-- плюс логистика плюс прочие расходы заказа, приведённые к рублям.
--
-- cost_basis — та самая честность источника: 'exact' ставится, только если заказ
-- найден, у каждой принятой позиции есть цена и все расходы удалось привести к рублям.
-- Во всех остальных случаях — 'estimated', и интерфейс обязан это показать, а не
-- выдавать расчётную цифру за точную.

create table if not exists public.stock_batches (
  id                uuid primary key default gen_random_uuid(),
  cabinet_id        uuid not null references public.wb_cabinets(id) on delete cascade,
  receipt_batch_id  uuid not null,
  order_id          uuid references public.purchase_orders(id) on delete set null,
  supplier          text not null default '',
  goods_amount      numeric(14, 2) not null default 0 check (goods_amount >= 0),
  logistics_amount  numeric(14, 2) not null default 0 check (logistics_amount >= 0),
  extra_amount      numeric(14, 2) not null default 0 check (extra_amount >= 0),
  total_amount      numeric(14, 2) not null default 0 check (total_amount >= 0),
  total_qty         integer not null default 0 check (total_qty >= 0),
  cost_basis        text not null default 'estimated' check (cost_basis in ('exact', 'estimated')),
  cost_note         text,
  posted_by         text,
  created_at        timestamptz not null default now()
);

create unique index if not exists stock_batches_receipt_unique
  on public.stock_batches (receipt_batch_id);
create index if not exists stock_batches_cabinet_idx
  on public.stock_batches (cabinet_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Регистр движений
-- ---------------------------------------------------------------------------
-- Только вставка. Ошиблись — сторнирующее движение, а не правка старого: иначе
-- «остаток = сумма движений» перестаёт быть правдой задним числом. Знак amount
-- всегда совпадает со знаком qty, поэтому взвешенное среднее по складу считается
-- прямым делением сумм.

create table if not exists public.stock_moves (
  id           bigint generated always as identity primary key,
  cabinet_id   uuid not null references public.wb_cabinets(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  nm_id        bigint not null,
  article      text not null default '',
  batch_id     uuid references public.stock_batches(id) on delete restrict,
  qty          integer not null check (qty <> 0),
  amount       numeric(14, 2) not null default 0,
  kind         text not null check (kind in ('receipt', 'shipment', 'writeoff', 'return', 'adjustment')),
  doc_type     text not null default 'manual',
  doc_id       text,
  occurred_at  timestamptz not null default now(),
  note         text,
  created_by   text,
  created_at   timestamptz not null default now()
);

create index if not exists stock_moves_balance_idx
  on public.stock_moves (cabinet_id, warehouse_id, nm_id);
create index if not exists stock_moves_batch_idx
  on public.stock_moves (batch_id);
create index if not exists stock_moves_recent_idx
  on public.stock_moves (cabinet_id, occurred_at desc);
create index if not exists stock_moves_doc_idx
  on public.stock_moves (doc_type, doc_id);

create or replace function public.stock_moves_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'stock_moves is append-only: сторнируйте движение, а не правьте его';
end;
$$;

drop trigger if exists stock_moves_append_only_trigger on public.stock_moves;
create trigger stock_moves_append_only_trigger
before update or delete on public.stock_moves
for each row execute function public.stock_moves_append_only();

-- ---------------------------------------------------------------------------
-- 4. Остаток как свёртка
-- ---------------------------------------------------------------------------

create or replace view public.stock_balances as
select
  m.cabinet_id,
  m.warehouse_id,
  m.nm_id,
  coalesce((array_agg(m.article order by m.occurred_at desc) filter (where m.article <> ''))[1], '') as article,
  sum(m.qty)::integer as qty,
  sum(m.amount)::numeric(14, 2) as amount,
  case when sum(m.qty) > 0 then round(sum(m.amount) / sum(m.qty), 2) else 0 end as unit_cost,
  max(m.occurred_at) as last_move_at
from public.stock_moves m
group by m.cabinet_id, m.warehouse_id, m.nm_id;

-- ---------------------------------------------------------------------------
-- 5. Приёмка учится проводиться
-- ---------------------------------------------------------------------------
-- Существующая вкладка «Приёмка» продолжает работать как была: она отмечает факт
-- (status='received'), но регистр не трогает. Проведение — отдельное действие модуля
-- «Склад», поэтому старые строки видны как «принято, но не проведено» и их можно
-- провести задним числом.

alter table public.purchase_receipts
  add column if not exists warehouse_id   uuid references public.warehouses(id),
  add column if not exists unit_cost      numeric(14, 4),
  add column if not exists stock_batch_id uuid references public.stock_batches(id),
  add column if not exists posted_at      timestamptz;

create index if not exists purchase_receipts_posting_idx
  on public.purchase_receipts (cabinet_id, status, posted_at);

-- Проводит принятые строки одной партии приёмки на склад: считает себестоимость,
-- заводит партию и пишет приходные движения. Идемпотентна — берёт только строки с
-- posted_at is null, и партия на batch_id может быть только одна.
create or replace function public.post_receipt_batch(
  p_batch_id uuid,
  p_warehouse_id uuid,
  p_actor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cabinet_id      uuid;
  v_warehouse       public.warehouses%rowtype;
  v_order           public.purchase_orders%rowtype;
  v_batch_id        uuid;
  v_goods           numeric(14, 2) := 0;
  v_logistics       numeric(14, 2) := 0;
  v_extra           numeric(14, 2) := 0;
  v_overhead        numeric(14, 2) := 0;
  v_qty             integer := 0;
  v_weight_total    numeric(18, 4) := 0;
  v_by_value        boolean := true;
  v_missing_price   boolean := false;
  v_unknown_extra   boolean := false;
  v_basis           text := 'exact';
  v_note            text := null;
  v_moves           integer := 0;
  v_row             record;
  v_line_goods      numeric(14, 2);
  v_line_weight     numeric(18, 4);
  v_line_total      numeric(14, 2);
begin
  select * into v_warehouse from public.warehouses where id = p_warehouse_id;
  if not found then raise exception 'warehouse not found'; end if;
  if not v_warehouse.is_active then raise exception 'warehouse is archived'; end if;

  select cabinet_id, sum(coalesce(received_qty, 0))::integer
    into v_cabinet_id, v_qty
  from public.purchase_receipts
  where batch_id = p_batch_id and status = 'received' and posted_at is null
  group by cabinet_id;

  if v_cabinet_id is null then
    return jsonb_build_object('posted', 0, 'reason', 'nothing_to_post');
  end if;
  if v_cabinet_id <> v_warehouse.cabinet_id then
    raise exception 'warehouse belongs to another cabinet';
  end if;
  if v_qty is null or v_qty = 0 then
    return jsonb_build_object('posted', 0, 'reason', 'zero_quantity');
  end if;

  select * into v_order from public.purchase_orders where receipt_batch_id = p_batch_id;

  if found then
    -- Стоимость товара считается по фактически принятым количествам, а не по заказанным:
    -- недопоставка не должна раздувать себестоимость приехавшего.
    select
      coalesce(sum(r.received_qty * coalesce(i.unit_price, 0)), 0) * v_order.exchange_rate,
      bool_or(i.unit_price is null or i.unit_price = 0)
      into v_goods, v_missing_price
    from public.purchase_receipts r
    left join public.purchase_order_items i
      on i.order_id = v_order.id and i.nm_id = r.nm_id
    where r.batch_id = p_batch_id and r.status = 'received' and r.posted_at is null;

    -- Этапы логистики ведутся в рублях (в карточке заказа поле «Стоимость логистики»
    -- рублёвое), поэтому конвертация к ним не применяется.
    select coalesce(sum(cost), 0) into v_logistics
    from public.purchase_logistics_stages where order_id = v_order.id;

    select
      coalesce(sum(case
        when currency = 'RUB' then amount
        when currency = v_order.currency then amount * v_order.exchange_rate
        else 0 end), 0),
      bool_or(currency <> 'RUB' and currency <> v_order.currency)
      into v_extra, v_unknown_extra
    from public.purchase_expenses where order_id = v_order.id;
  else
    v_missing_price := true;
  end if;

  v_overhead := v_logistics + v_extra;
  v_by_value := v_goods > 0;

  if v_missing_price or v_unknown_extra or v_order.id is null then
    v_basis := 'estimated';
  end if;
  v_note := nullif(concat_ws('; ',
    case when v_order.id is null then 'приёмка без заказа фабрике' end,
    case when v_missing_price then 'у части позиций нет цены' end,
    case when v_unknown_extra then 'расход в валюте без курса не учтён' end
  ), '');

  -- Накладные разносятся пропорционально стоимости позиции, а когда цен нет —
  -- пропорционально количеству: иначе весь довесок осел бы на одной строке.
  if v_by_value then
    v_weight_total := v_goods;
  else
    v_weight_total := v_qty;
  end if;

  v_batch_id := gen_random_uuid();
  insert into public.stock_batches (
    id, cabinet_id, receipt_batch_id, order_id, supplier,
    goods_amount, logistics_amount, extra_amount, total_amount, total_qty,
    cost_basis, cost_note, posted_by
  ) values (
    v_batch_id, v_cabinet_id, p_batch_id, v_order.id, coalesce(v_order.supplier, ''),
    v_goods, v_logistics, v_extra, v_goods + v_overhead, v_qty,
    v_basis, v_note, p_actor
  );

  for v_row in
    select r.id, r.nm_id, r.article, r.received_qty, coalesce(i.unit_price, 0) as unit_price
    from public.purchase_receipts r
    left join public.purchase_order_items i
      on v_order.id is not null and i.order_id = v_order.id and i.nm_id = r.nm_id
    where r.batch_id = p_batch_id and r.status = 'received' and r.posted_at is null
      and coalesce(r.received_qty, 0) > 0
  loop
    v_line_goods := v_row.received_qty * v_row.unit_price * coalesce(v_order.exchange_rate, 1);
    v_line_weight := case when v_by_value then v_line_goods else v_row.received_qty end;
    v_line_total := v_line_goods + case
      when v_weight_total > 0 then v_overhead * (v_line_weight / v_weight_total)
      else 0 end;

    insert into public.stock_moves (
      cabinet_id, warehouse_id, nm_id, article, batch_id,
      qty, amount, kind, doc_type, doc_id, created_by
    ) values (
      v_cabinet_id, p_warehouse_id, v_row.nm_id, v_row.article, v_batch_id,
      v_row.received_qty, round(v_line_total, 2), 'receipt', 'purchase_receipt', p_batch_id::text, p_actor
    );

    update public.purchase_receipts
    set warehouse_id = p_warehouse_id,
        stock_batch_id = v_batch_id,
        unit_cost = round(v_line_total / v_row.received_qty, 4),
        posted_at = now(),
        updated_at = now()
    where id = v_row.id;

    v_moves := v_moves + 1;
  end loop;

  insert into public.operation_audit_log (
    cabinet_id, entity_type, entity_id, action, actor, after_data
  ) values (
    v_cabinet_id, 'stock_batch', v_batch_id, 'receipt_posted', p_actor,
    jsonb_build_object(
      'receiptBatchId', p_batch_id,
      'warehouseId', p_warehouse_id,
      'qty', v_qty,
      'total', v_goods + v_overhead,
      'costBasis', v_basis
    )
  );

  return jsonb_build_object(
    'posted', v_moves,
    'batchId', v_batch_id,
    'qty', v_qty,
    'total', v_goods + v_overhead,
    'costBasis', v_basis,
    'costNote', v_note
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Доступы
-- ---------------------------------------------------------------------------

alter table public.warehouses enable row level security;
alter table public.stock_batches enable row level security;
alter table public.stock_moves enable row level security;

drop policy if exists "all" on public.warehouses;
drop policy if exists "all" on public.stock_batches;
drop policy if exists "all" on public.stock_moves;
create policy "all" on public.warehouses for all using (true) with check (true);
create policy "all" on public.stock_batches for all using (true) with check (true);
create policy "all" on public.stock_moves for all using (true) with check (true);

revoke all on table public.warehouses from anon, authenticated;
revoke all on table public.stock_batches from anon, authenticated;
revoke all on table public.stock_moves from anon, authenticated;
revoke all on public.stock_balances from anon, authenticated;

revoke all on function public.post_receipt_batch(uuid, uuid, text) from public;
grant execute on function public.post_receipt_batch(uuid, uuid, text) to service_role;
