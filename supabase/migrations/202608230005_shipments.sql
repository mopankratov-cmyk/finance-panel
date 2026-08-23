-- Отгрузка со склада на кабинеты и общий склад вместо склада-на-юрлицо.
--
-- Две правки по итогам разбора рабочего процесса:
--
-- 1. Склад перестаёт принадлежать юрлицу. На одном физическом складе (фулфилмент)
--    лежит товар нескольких юрлиц, и привязка склада к одному из них заставляла бы
--    заводить три строки с одним названием. Теперь склад — это место, а чей товар
--    на нём лежит, говорит движение: остаток считается по паре «склад + юрлицо».
--
-- 2. Появляется отгрузка: товар уходит со склада сразу на несколько кабинетов одной
--    операцией. Транзита нет — списываем в момент отгрузки, как решено владельцем:
--    дальше товар живёт в остатках маркетплейса, которые приходят из его API.

-- ---------------------------------------------------------------------------
-- 1. Склад — общий
-- ---------------------------------------------------------------------------

drop index if exists warehouses_entity_name_unique;
drop index if exists warehouses_entity_idx;
alter table public.warehouses drop column if exists legal_entity_id;

create unique index if not exists warehouses_name_unique
  on public.warehouses (lower(name));
create index if not exists warehouses_active_idx
  on public.warehouses (is_active, position);

-- ---------------------------------------------------------------------------
-- 2. Представление остатков — по юрлицу и складу
-- ---------------------------------------------------------------------------
-- Пересоздаётся здесь же: в 202608230004 оно у части баз осталось в старом виде
-- (PostgREST продолжал отдавать прежние колонки).

drop view if exists public.stock_balances;

create view public.stock_balances as
select
  m.legal_entity_id,
  m.warehouse_id,
  m.nm_id,
  coalesce((array_agg(m.article order by m.occurred_at desc) filter (where m.article <> ''))[1], '') as article,
  sum(m.qty)::integer as qty,
  sum(m.amount)::numeric(14, 2) as amount,
  case when sum(m.qty) > 0 then round(sum(m.amount) / sum(m.qty), 2) else 0 end as unit_cost,
  max(m.occurred_at) as last_move_at
from public.stock_moves m
group by m.legal_entity_id, m.warehouse_id, m.nm_id;

revoke all on public.stock_balances from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Приёмка больше не сверяет юрлицо склада
-- ---------------------------------------------------------------------------

create or replace function public.post_receipt_batch(
  p_batch_id uuid,
  p_warehouse_id uuid,
  p_actor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $post_receipt_batch$
declare
  v_cabinet_id      uuid;
  v_entity_id       uuid;
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
  if v_qty is null or v_qty = 0 then
    return jsonb_build_object('posted', 0, 'reason', 'zero_quantity');
  end if;

  select legal_entity_id into v_entity_id
  from public.legal_entity_cabinets
  where cabinet_id = v_cabinet_id and relation = 'own'
  limit 1;
  if v_entity_id is null then raise exception 'cabinet has no legal entity'; end if;

  select * into v_order from public.purchase_orders where receipt_batch_id = p_batch_id;

  if found then
    select
      coalesce(sum(r.received_qty * coalesce(i.unit_price, 0)), 0) * v_order.exchange_rate,
      bool_or(i.unit_price is null or i.unit_price = 0)
      into v_goods, v_missing_price
    from public.purchase_receipts r
    left join public.purchase_order_items i
      on i.order_id = v_order.id and i.nm_id = r.nm_id
    where r.batch_id = p_batch_id and r.status = 'received' and r.posted_at is null;

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

  if v_by_value then v_weight_total := v_goods; else v_weight_total := v_qty; end if;

  v_batch_id := gen_random_uuid();
  insert into public.stock_batches (
    id, legal_entity_id, receipt_batch_id, order_id, supplier,
    goods_amount, logistics_amount, extra_amount, total_amount, total_qty,
    cost_basis, cost_note, posted_by
  ) values (
    v_batch_id, v_entity_id, p_batch_id, v_order.id, coalesce(v_order.supplier, ''),
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
      legal_entity_id, cabinet_id, warehouse_id, nm_id, article, batch_id,
      qty, amount, kind, doc_type, doc_id, created_by
    ) values (
      v_entity_id, null, p_warehouse_id, v_row.nm_id, v_row.article, v_batch_id,
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
      'legalEntityId', v_entity_id,
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
$post_receipt_batch$;

revoke all on function public.post_receipt_batch(uuid, uuid, text) from public;
grant execute on function public.post_receipt_batch(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Отгрузка на кабинеты
-- ---------------------------------------------------------------------------
-- Одна операция списывает товар со склада и раскладывает его по кабинетам: строка
-- на пару «SKU + кабинет». Все строки получают общий doc_id, поэтому отгрузку видно
-- в журнале как одно событие, а отдельной таблицы документов не требуется.
--
-- Списание идёт по средневзвешенной себестоимости склада на момент отгрузки — той же,
-- что показывает stock_balances. Уходить в минус нельзя: отрицательный остаток означает,
-- что регистр разошёлся с физическим складом, и молча продолжать тут вреднее, чем упасть.

create or replace function public.post_shipment(
  p_legal_entity_id uuid,
  p_warehouse_id uuid,
  p_lines jsonb,
  p_note text default null,
  p_actor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $post_shipment$
declare
  v_warehouse   public.warehouses%rowtype;
  v_doc_id      uuid;
  v_line        record;
  v_available   integer;
  v_unit_cost   numeric(14, 2);
  v_needed      integer;
  v_moves       integer := 0;
  v_qty_total   integer := 0;
  v_amount_total numeric(14, 2) := 0;
  v_audit_cabinet uuid;
begin
  select * into v_warehouse from public.warehouses where id = p_warehouse_id;
  if not found then raise exception 'warehouse not found'; end if;
  if not v_warehouse.is_active then raise exception 'warehouse is archived'; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'shipment has no lines'; end if;

  -- Сначала проверяем весь документ и только потом пишем: частично проведённая
  -- отгрузка хуже непроведённой.
  for v_line in
    select
      (item->>'nmId')::bigint as nm_id,
      sum((item->>'qty')::integer) as qty
    from jsonb_array_elements(p_lines) as item
    group by (item->>'nmId')::bigint
  loop
    if v_line.qty is null or v_line.qty <= 0 then raise exception 'quantity must be positive'; end if;
    select coalesce(sum(qty), 0) into v_available
    from public.stock_moves
    where legal_entity_id = p_legal_entity_id and warehouse_id = p_warehouse_id and nm_id = v_line.nm_id;
    if v_available < v_line.qty then
      raise exception 'not enough stock for nm % : have %, need %', v_line.nm_id, v_available, v_line.qty;
    end if;
  end loop;

  v_doc_id := gen_random_uuid();

  for v_line in
    select
      (item->>'nmId')::bigint as nm_id,
      coalesce(item->>'article', '') as article,
      nullif(item->>'cabinetId', '')::uuid as cabinet_id,
      (item->>'qty')::integer as qty
    from jsonb_array_elements(p_lines) as item
  loop
    select
      coalesce(sum(qty), 0),
      case when coalesce(sum(qty), 0) > 0 then round(coalesce(sum(amount), 0) / sum(qty), 2) else 0 end
      into v_needed, v_unit_cost
    from public.stock_moves
    where legal_entity_id = p_legal_entity_id and warehouse_id = p_warehouse_id and nm_id = v_line.nm_id;

    insert into public.stock_moves (
      legal_entity_id, cabinet_id, warehouse_id, nm_id, article,
      qty, amount, kind, doc_type, doc_id, note, created_by
    ) values (
      p_legal_entity_id, v_line.cabinet_id, p_warehouse_id, v_line.nm_id, v_line.article,
      -v_line.qty, -round(v_unit_cost * v_line.qty, 2), 'shipment', 'shipment', v_doc_id::text, p_note, p_actor
    );

    v_moves := v_moves + 1;
    v_qty_total := v_qty_total + v_line.qty;
    v_amount_total := v_amount_total + round(v_unit_cost * v_line.qty, 2);
  end loop;

  -- В журнале аудита кабинет обязателен, а у отгрузки их может быть несколько:
  -- пишем первый указанный. Если кабинета нет ни у одной строки (отгрузка не на
  -- маркетплейс), запись в аудит пропускается — движения в регистре всё равно есть.
  select nullif(item->>'cabinetId', '')::uuid into v_audit_cabinet
  from jsonb_array_elements(p_lines) as item
  where nullif(item->>'cabinetId', '') is not null
  limit 1;

  if v_audit_cabinet is not null then
    insert into public.operation_audit_log (
      cabinet_id, entity_type, entity_id, action, actor, after_data
    ) values (
      v_audit_cabinet, 'stock_shipment', v_doc_id, 'shipment_posted', p_actor,
      jsonb_build_object(
        'legalEntityId', p_legal_entity_id,
        'warehouseId', p_warehouse_id,
        'lines', v_moves,
        'qty', v_qty_total,
        'amount', v_amount_total
      )
    );
  end if;

  return jsonb_build_object(
    'shipmentId', v_doc_id,
    'lines', v_moves,
    'qty', v_qty_total,
    'amount', v_amount_total
  );
end;
$post_shipment$;

revoke all on function public.post_shipment(uuid, uuid, jsonb, text, text) from public;
grant execute on function public.post_shipment(uuid, uuid, jsonb, text, text) to service_role;

notify pgrst, 'reload schema';
