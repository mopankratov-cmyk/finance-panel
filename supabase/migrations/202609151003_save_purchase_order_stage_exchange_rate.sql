-- save_purchase_order: пишет exchange_rate этапа оплаты (202609151002).
-- Тело функции иначе не тронуто (сверено построчно с действующей версией в
-- 202609140004_purchase_orders_supplier_id_rpc.sql) — единственная разница в
-- списке колонок и values блока purchase_payment_stages.

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
      id, cabinet_id, order_number, supplier, supplier_id, order_date, production_days,
      expected_ready_date, currency, exchange_rate, status, note,
      idempotency_key, created_by, updated_by
    ) values (
      v_id,
      v_cabinet_id,
      v_order_number,
      trim(coalesce(p_order->>'supplier', '')),
      nullif(p_order->>'supplierId', '')::uuid,
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
      supplier_id = nullif(p_order->>'supplierId', '')::uuid,
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
  insert into public.purchase_payment_stages (order_id, title, percent, amount, exchange_rate, due_date, paid_at, status, position)
  select
    v_id,
    trim(stage->>'title'),
    greatest(0, least(100, coalesce((stage->>'percent')::numeric, 0))),
    greatest(0, coalesce((stage->>'amount')::numeric, 0)),
    nullif(stage->>'exchangeRate', '')::numeric,
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
