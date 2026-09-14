-- Атомарное сохранение отгрузки + её состава по позициям — тот же паттерн,
-- что save_purchase_order: одна функция, чтобы autosave/повторный клик не
-- оставлял половину документа. cabinet_id для audit_log берём из заказа —
-- у самой отгрузки его нет (кабинет закреплён за заказом, не за отгрузкой).
--
-- Только функция, без DDL — тот же файл-на-функцию, что и остальные RPC
-- в этом контуре.

create or replace function public.save_supplier_shipment(p_shipment jsonb, p_actor text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_order_id uuid;
  v_cabinet_id uuid;
  v_status text;
  v_before jsonb;
  v_after jsonb;
begin
  v_order_id := nullif(p_shipment->>'orderId', '')::uuid;
  v_status := coalesce(nullif(p_shipment->>'status', ''), 'planned');
  if v_order_id is null then raise exception 'orderId is required'; end if;
  if v_status not in ('planned', 'shipped', 'customs', 'arrived', 'received', 'cancelled') then
    raise exception 'invalid shipment status';
  end if;

  select cabinet_id into v_cabinet_id from public.purchase_orders where id = v_order_id;
  if v_cabinet_id is null then raise exception 'order not found'; end if;

  v_id := coalesce(nullif(p_shipment->>'id', '')::uuid, gen_random_uuid());
  select to_jsonb(s) into v_before from public.supplier_shipments s where s.id = v_id;
  if v_before is not null and (v_before->>'order_id')::uuid <> v_order_id then
    raise exception 'shipment order cannot be changed';
  end if;

  -- Снимок состава ДО удаления ниже — тот же приём, что 202609140005 для
  -- save_purchase_order: иначе история правки отгрузки теряет прежний
  -- состав молча, без ошибки в консоли.
  if v_before is not null then
    v_before := v_before || jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(jsonb_build_object('nmId', i.nm_id, 'article', i.article, 'quantity', i.quantity))
        from public.supplier_shipment_items i where i.shipment_id = v_id
      ), '[]'::jsonb)
    );
  end if;

  if v_before is null then
    insert into public.supplier_shipments (
      id, order_id, carrier, route, status, eta, shipped_at, arrived_at, received_at, note, created_by, updated_by
    ) values (
      v_id,
      v_order_id,
      trim(coalesce(p_shipment->>'carrier', '')),
      trim(coalesce(p_shipment->>'route', '')),
      v_status,
      nullif(p_shipment->>'eta', '')::date,
      nullif(p_shipment->>'shippedAt', '')::timestamptz,
      nullif(p_shipment->>'arrivedAt', '')::timestamptz,
      nullif(p_shipment->>'receivedAt', '')::timestamptz,
      nullif(p_shipment->>'note', ''),
      p_actor,
      p_actor
    );
  else
    update public.supplier_shipments set
      carrier = trim(coalesce(p_shipment->>'carrier', '')),
      route = trim(coalesce(p_shipment->>'route', '')),
      status = v_status,
      eta = nullif(p_shipment->>'eta', '')::date,
      shipped_at = nullif(p_shipment->>'shippedAt', '')::timestamptz,
      arrived_at = nullif(p_shipment->>'arrivedAt', '')::timestamptz,
      received_at = nullif(p_shipment->>'receivedAt', '')::timestamptz,
      note = nullif(p_shipment->>'note', ''),
      updated_by = p_actor,
      updated_at = now()
    where id = v_id;
  end if;

  delete from public.supplier_shipment_items where shipment_id = v_id;
  insert into public.supplier_shipment_items (shipment_id, nm_id, article, quantity)
  select
    v_id,
    (item->>'nmId')::bigint,
    trim(coalesce(item->>'article', '')),
    greatest(1, (item->>'quantity')::integer)
  from jsonb_array_elements(coalesce(p_shipment->'items', '[]'::jsonb)) item;

  select to_jsonb(s) into v_after from public.supplier_shipments s where s.id = v_id;
  insert into public.operation_audit_log (
    cabinet_id, entity_type, entity_id, action, actor, before_data, after_data
  ) values (
    v_cabinet_id,
    'supplier_shipment',
    v_id,
    case when v_before is null then 'created' else 'updated' end,
    p_actor,
    v_before,
    v_after || jsonb_build_object('items', coalesce(p_shipment->'items', '[]'::jsonb))
  );
  return v_id;
end;
$$;

revoke all on function public.save_supplier_shipment(jsonb, text) from public;
grant execute on function public.save_supplier_shipment(jsonb, text) to service_role;
