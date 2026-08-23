-- Приёмка, отгрузка и списание переходят на варианты.
--
-- Регистр теперь адресует «модель + размер». Документы принимают variant_id, а там,
-- где размер не указан (приёмка из «Закупок», старые вызовы), подставляется базовый
-- вариант модели — тот самый, что представляет её без размера.

-- Вариант по модели: указанный или базовый. Одно место, где решается эта развилка.
create or replace function public.resolve_variant(
  p_product_id uuid,
  p_variant_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $resolve_variant$
declare
  v_id uuid;
begin
  if p_variant_id is not null then
    select id into v_id from public.product_variants
    where id = p_variant_id and product_id = p_product_id;
    if v_id is null then raise exception 'variant does not belong to product'; end if;
    return v_id;
  end if;

  select id into v_id from public.product_variants
  where product_id = p_product_id and is_default limit 1;
  if v_id is not null then return v_id; end if;

  -- Товар без базового варианта — это товар, заведённый в обход справочника.
  -- Создаём базовый на лету, иначе приёмка упрётся в пустоту.
  insert into public.product_variants (product_id, size_label, is_default)
  values (p_product_id, '', true)
  returning id into v_id;
  return v_id;
end;
$resolve_variant$;

revoke all on function public.resolve_variant(uuid, uuid) from public;
grant execute on function public.resolve_variant(uuid, uuid) to service_role;

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
  v_defects         integer := 0;
  v_weight_total    numeric(18, 4) := 0;
  v_by_value        boolean := true;
  v_from_card       boolean := false;
  v_missing_price   boolean := false;
  v_no_rate         boolean := false;
  v_unknown_extra   boolean := false;
  v_basis           text := 'exact';
  v_note            text := null;
  v_moves           integer := 0;
  v_row             record;
  v_product         public.products%rowtype;
  v_line_price      numeric(14, 4);
  v_rate            numeric(14, 4);
  v_line_goods      numeric(14, 2);
  v_line_weight     numeric(18, 4);
  v_line_total      numeric(14, 2);
  v_unit_cost       numeric(14, 4);
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

  if exists (
    select 1 from public.purchase_receipts
    where batch_id = p_batch_id and status = 'received' and posted_at is null
      and defect_qty > coalesce(received_qty, 0)
  ) then
    raise exception 'defect exceeds received';
  end if;

  select legal_entity_id into v_entity_id
  from public.legal_entity_cabinets
  where cabinet_id = v_cabinet_id and relation = 'own'
  limit 1;
  if v_entity_id is null then raise exception 'cabinet has no legal entity'; end if;

  select * into v_order from public.purchase_orders where receipt_batch_id = p_batch_id;

  -- Товар и вариант у каждой строки: без них цену брать неоткуда и писать некуда.
  for v_row in
    select r.id, r.nm_id, r.article, r.product_id, r.variant_id
    from public.purchase_receipts r
    where r.batch_id = p_batch_id and r.status = 'received' and r.posted_at is null
      and coalesce(r.received_qty, 0) > 0
      and (r.product_id is null or r.variant_id is null)
  loop
    update public.purchase_receipts
    set product_id = coalesce(v_row.product_id, public.resolve_product(v_entity_id, v_row.nm_id, v_row.article)),
        updated_at = now()
    where id = v_row.id;

    update public.purchase_receipts r
    set variant_id = public.resolve_variant(r.product_id, r.variant_id),
        updated_at = now()
    where r.id = v_row.id;
  end loop;

  for v_row in
    select r.id, r.nm_id, r.article, r.product_id, r.received_qty,
           coalesce(i.unit_price, 0) as unit_price
    from public.purchase_receipts r
    left join public.purchase_order_items i
      on v_order.id is not null and i.order_id = v_order.id and i.nm_id = r.nm_id
    where r.batch_id = p_batch_id and r.status = 'received' and r.posted_at is null
      and coalesce(r.received_qty, 0) > 0
  loop
    select * into v_product from public.products where id = v_row.product_id;

    if v_row.unit_price > 0 and v_order.id is not null then
      v_line_price := v_row.unit_price;
      v_rate := coalesce(v_order.exchange_rate, 1);
    elsif v_product.factory_price is not null and v_product.factory_price > 0 then
      v_from_card := true;
      v_line_price := v_product.factory_price;
      if v_product.factory_currency = 'RUB' then
        v_rate := 1;
      else
        select exchange_rate into v_rate
        from public.purchase_orders
        where currency = v_product.factory_currency
        order by order_date desc, created_at desc
        limit 1;
        if v_rate is null then
          v_no_rate := true;
          v_rate := 0;
        end if;
      end if;
    else
      v_missing_price := true;
      v_line_price := 0;
      v_rate := 0;
    end if;

    v_line_goods := round(v_row.received_qty * v_line_price * v_rate, 2);
    v_goods := v_goods + v_line_goods;

    update public.purchase_receipts
    set unit_cost = case when v_row.received_qty > 0 then round(v_line_goods / v_row.received_qty, 4) else 0 end,
        updated_at = now()
    where id = v_row.id;
  end loop;

  if v_order.id is not null then
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
  end if;

  v_overhead := v_logistics + v_extra;
  v_by_value := v_goods > 0;

  if v_missing_price or v_unknown_extra or v_no_rate or v_from_card or v_order.id is null then
    v_basis := 'estimated';
  end if;
  v_note := nullif(concat_ws(',',
    case when v_order.id is null then 'no_order' end,
    case when v_from_card then 'price_from_card' end,
    case when v_no_rate then 'no_rate' end,
    case when v_missing_price then 'missing_price' end,
    case when v_unknown_extra then 'unknown_extra' end
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
    select r.id as receipt_id, r.product_id, r.variant_id, r.nm_id, r.article,
           r.received_qty as qty, coalesce(r.defect_qty, 0) as defect,
           round(coalesce(r.unit_cost, 0) * r.received_qty, 2) as goods
    from public.purchase_receipts r
    where r.batch_id = p_batch_id and r.status = 'received' and r.posted_at is null
      and coalesce(r.received_qty, 0) > 0
  loop
    v_line_weight := case when v_by_value then v_row.goods else v_row.qty end;
    v_line_total := v_row.goods + case
      when v_weight_total > 0 then v_overhead * (v_line_weight / v_weight_total)
      else 0 end;
    v_unit_cost := case when v_row.qty > 0 then round(v_line_total / v_row.qty, 4) else 0 end;

    insert into public.stock_moves (
      legal_entity_id, cabinet_id, warehouse_id, product_id, variant_id, nm_id, article, batch_id,
      qty, amount, kind, doc_type, doc_id, created_by
    ) values (
      v_entity_id, null, p_warehouse_id, v_row.product_id, v_row.variant_id, v_row.nm_id, v_row.article, v_batch_id,
      v_row.qty, round(v_line_total, 2), 'receipt', 'purchase_receipt', p_batch_id::text, p_actor
    );

    if v_row.defect > 0 then
      insert into public.stock_moves (
        legal_entity_id, cabinet_id, warehouse_id, product_id, variant_id, nm_id, article, batch_id,
        qty, amount, kind, doc_type, doc_id, note, created_by
      ) values (
        v_entity_id, null, p_warehouse_id, v_row.product_id, v_row.variant_id, v_row.nm_id, v_row.article, v_batch_id,
        -v_row.defect, -round(v_unit_cost * v_row.defect, 2), 'writeoff', 'purchase_receipt', p_batch_id::text,
        'defect_on_receipt', p_actor
      );
      v_defects := v_defects + v_row.defect;
    end if;

    update public.purchase_receipts
    set warehouse_id = p_warehouse_id,
        stock_batch_id = v_batch_id,
        unit_cost = v_unit_cost,
        posted_at = now(),
        updated_at = now()
    where id = v_row.receipt_id;

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
      'defects', v_defects,
      'total', v_goods + v_overhead,
      'costBasis', v_basis
    )
  );

  return jsonb_build_object(
    'posted', v_moves,
    'batchId', v_batch_id,
    'qty', v_qty,
    'defects', v_defects,
    'total', v_goods + v_overhead,
    'costBasis', v_basis,
    'costNote', v_note
  );
end;
$post_receipt_batch$;

revoke all on function public.post_receipt_batch(uuid, uuid, text) from public;
grant execute on function public.post_receipt_batch(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------

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
  v_moves       integer := 0;
  v_qty_total   integer := 0;
  v_amount_total numeric(14, 2) := 0;
  v_audit_cabinet uuid;
  v_variant     public.product_variants%rowtype;
  v_product     public.products%rowtype;
begin
  select * into v_warehouse from public.warehouses where id = p_warehouse_id;
  if not found then raise exception 'warehouse not found'; end if;
  if not v_warehouse.is_active then raise exception 'warehouse is archived'; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'shipment has no lines'; end if;

  for v_line in
    select (item->>'variantId')::uuid as variant_id, sum((item->>'qty')::integer) as qty
    from jsonb_array_elements(p_lines) as item
    group by (item->>'variantId')::uuid
  loop
    if v_line.qty is null or v_line.qty <= 0 then raise exception 'quantity must be positive'; end if;
    select coalesce(sum(qty), 0) into v_available
    from public.stock_moves
    where legal_entity_id = p_legal_entity_id and warehouse_id = p_warehouse_id and variant_id = v_line.variant_id;
    if v_available < v_line.qty then
      select * into v_variant from public.product_variants where id = v_line.variant_id;
      select * into v_product from public.products where id = v_variant.product_id;
      raise exception 'not enough stock for % : have %, need %',
        trim(coalesce(v_product.article, '') || ' ' || coalesce(v_variant.size_label, '')), v_available, v_line.qty;
    end if;
  end loop;

  v_doc_id := gen_random_uuid();

  for v_line in
    select
      (item->>'variantId')::uuid as variant_id,
      nullif(item->>'cabinetId', '')::uuid as cabinet_id,
      (item->>'qty')::integer as qty
    from jsonb_array_elements(p_lines) as item
  loop
    select * into v_variant from public.product_variants where id = v_line.variant_id;
    if not found then raise exception 'variant not found'; end if;
    select * into v_product from public.products where id = v_variant.product_id;

    select
      case when coalesce(sum(qty), 0) > 0 then round(coalesce(sum(amount), 0) / sum(qty), 2) else 0 end
      into v_unit_cost
    from public.stock_moves
    where legal_entity_id = p_legal_entity_id and warehouse_id = p_warehouse_id and variant_id = v_line.variant_id;

    insert into public.stock_moves (
      legal_entity_id, cabinet_id, warehouse_id, product_id, variant_id, nm_id, article,
      qty, amount, kind, doc_type, doc_id, note, created_by
    ) values (
      p_legal_entity_id, v_line.cabinet_id, p_warehouse_id, v_variant.product_id, v_line.variant_id,
      v_product.nm_id, v_product.article,
      -v_line.qty, -round(v_unit_cost * v_line.qty, 2), 'shipment', 'shipment', v_doc_id::text, p_note, p_actor
    );

    v_moves := v_moves + 1;
    v_qty_total := v_qty_total + v_line.qty;
    v_amount_total := v_amount_total + round(v_unit_cost * v_line.qty, 2);
  end loop;

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

-- ---------------------------------------------------------------------------

create or replace function public.post_writeoff(
  p_legal_entity_id uuid,
  p_warehouse_id uuid,
  p_lines jsonb,
  p_reason text,
  p_actor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $post_writeoff$
declare
  v_warehouse   public.warehouses%rowtype;
  v_doc_id      uuid;
  v_line        record;
  v_available   integer;
  v_unit_cost   numeric(14, 2);
  v_moves       integer := 0;
  v_qty_total   integer := 0;
  v_amount_total numeric(14, 2) := 0;
  v_variant     public.product_variants%rowtype;
  v_product     public.products%rowtype;
begin
  select * into v_warehouse from public.warehouses where id = p_warehouse_id;
  if not found then raise exception 'warehouse not found'; end if;
  if not v_warehouse.is_active then raise exception 'warehouse is archived'; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'writeoff has no lines'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'reason required'; end if;

  for v_line in
    select (item->>'variantId')::uuid as variant_id, sum((item->>'qty')::integer) as qty
    from jsonb_array_elements(p_lines) as item
    group by (item->>'variantId')::uuid
  loop
    if v_line.qty is null or v_line.qty <= 0 then raise exception 'quantity must be positive'; end if;
    select coalesce(sum(qty), 0) into v_available
    from public.stock_moves
    where legal_entity_id = p_legal_entity_id and warehouse_id = p_warehouse_id and variant_id = v_line.variant_id;
    if v_available < v_line.qty then
      select * into v_variant from public.product_variants where id = v_line.variant_id;
      select * into v_product from public.products where id = v_variant.product_id;
      raise exception 'not enough stock for % : have %, need %',
        trim(coalesce(v_product.article, '') || ' ' || coalesce(v_variant.size_label, '')), v_available, v_line.qty;
    end if;
  end loop;

  v_doc_id := gen_random_uuid();

  for v_line in
    select (item->>'variantId')::uuid as variant_id, (item->>'qty')::integer as qty
    from jsonb_array_elements(p_lines) as item
  loop
    select * into v_variant from public.product_variants where id = v_line.variant_id;
    if not found then raise exception 'variant not found'; end if;
    select * into v_product from public.products where id = v_variant.product_id;

    select
      case when coalesce(sum(qty), 0) > 0 then round(coalesce(sum(amount), 0) / sum(qty), 2) else 0 end
      into v_unit_cost
    from public.stock_moves
    where legal_entity_id = p_legal_entity_id and warehouse_id = p_warehouse_id and variant_id = v_line.variant_id;

    insert into public.stock_moves (
      legal_entity_id, cabinet_id, warehouse_id, product_id, variant_id, nm_id, article,
      qty, amount, kind, doc_type, doc_id, note, created_by
    ) values (
      p_legal_entity_id, null, p_warehouse_id, v_variant.product_id, v_line.variant_id,
      v_product.nm_id, v_product.article,
      -v_line.qty, -round(v_unit_cost * v_line.qty, 2), 'writeoff', 'writeoff', v_doc_id::text, p_reason, p_actor
    );

    v_moves := v_moves + 1;
    v_qty_total := v_qty_total + v_line.qty;
    v_amount_total := v_amount_total + round(v_unit_cost * v_line.qty, 2);
  end loop;

  return jsonb_build_object(
    'writeoffId', v_doc_id,
    'lines', v_moves,
    'qty', v_qty_total,
    'amount', v_amount_total
  );
end;
$post_writeoff$;

revoke all on function public.post_writeoff(uuid, uuid, jsonb, text, text) from public;
grant execute on function public.post_writeoff(uuid, uuid, jsonb, text, text) to service_role;

notify pgrst, 'reload schema';
