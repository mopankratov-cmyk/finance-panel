-- Приёмка без заказа фабрике больше не кладёт товар на склад по нулю.
--
-- Проверка на живых данных показала: если поставку принять без заказа, себестоимость
-- выходила 0 ₽ — хотя цена фабрики в карточке товара заполнена. Функция смотрела
-- только в заказ. Теперь, когда цены в заказе нет, берётся цена из карточки товара,
-- приведённая к рублям по последнему известному курсу этой валюты (из заказов фабрике).
--
-- Такая себестоимость всегда помечается расчётной и объясняет себя: «цена из карточки
-- товара», «нет курса для CNY». Точной она называется только тогда, когда пришла
-- из заказа целиком.

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
  v_from_card       boolean := false;
  v_missing_price   boolean := false;
  v_no_rate         boolean := false;
  v_unknown_extra   boolean := false;
  v_basis           text := 'exact';
  v_note            text := null;
  v_moves           integer := 0;
  v_row             record;
  v_product         public.products%rowtype;
  v_product_id      uuid;
  v_line_price      numeric(14, 4);
  v_rate            numeric(14, 4);
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

  -- Первый проход: у каждой строки должен быть товар — иначе цену брать неоткуда.
  -- Проставляем его прямо в приёмке, тогда дальше всё считается обычными запросами.
  for v_row in
    select r.id, r.nm_id, r.article, r.product_id
    from public.purchase_receipts r
    where r.batch_id = p_batch_id and r.status = 'received' and r.posted_at is null
      and coalesce(r.received_qty, 0) > 0 and r.product_id is null
  loop
    update public.purchase_receipts
    set product_id = public.resolve_product(v_entity_id, v_row.nm_id, v_row.article),
        updated_at = now()
    where id = v_row.id;
  end loop;

  -- Второй проход: цена строки — из заказа, а если её там нет, из карточки товара
  -- по последнему известному курсу этой валюты.
  for v_row in
    select r.id, r.nm_id, r.article, r.product_id, r.received_qty,
           coalesce(i.unit_price, 0) as unit_price
    from public.purchase_receipts r
    left join public.purchase_order_items i
      on v_order.id is not null and i.order_id = v_order.id and i.nm_id = r.nm_id
    where r.batch_id = p_batch_id and r.status = 'received' and r.posted_at is null
      and coalesce(r.received_qty, 0) > 0
  loop
    v_product_id := v_row.product_id;
    select * into v_product from public.products where id = v_product_id;

    if v_row.unit_price > 0 and v_order.id is not null then
      v_line_price := v_row.unit_price;
      v_rate := coalesce(v_order.exchange_rate, 1);
    elsif v_product.factory_price is not null and v_product.factory_price > 0 then
      v_from_card := true;
      v_line_price := v_product.factory_price;
      if v_product.factory_currency = 'RUB' then
        v_rate := 1;
      else
        -- Курса ЦБ в базе нет, зато есть курсы заказов фабрике: берём последний
        -- по этой валюте. Если заказов в ней не было — цену не считаем и говорим об этом.
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

    -- Цену строки держим в самой приёмке: следующий проход возьмёт её оттуда.
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
  v_note := nullif(concat_ws('; ',
    case when v_order.id is null then 'приёмка без заказа фабрике' end,
    case when v_from_card then 'цена взята из карточки товара' end,
    case when v_no_rate then 'нет курса для валюты цены фабрики' end,
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

  -- Третий проход: разносим накладные и пишем движения.
  for v_row in
    select r.id as receipt_id, r.product_id, r.nm_id, r.article,
           r.received_qty as qty, round(coalesce(r.unit_cost, 0) * r.received_qty, 2) as goods
    from public.purchase_receipts r
    where r.batch_id = p_batch_id and r.status = 'received' and r.posted_at is null
      and coalesce(r.received_qty, 0) > 0
  loop
    v_line_weight := case when v_by_value then v_row.goods else v_row.qty end;
    v_line_total := v_row.goods + case
      when v_weight_total > 0 then v_overhead * (v_line_weight / v_weight_total)
      else 0 end;

    insert into public.stock_moves (
      legal_entity_id, cabinet_id, warehouse_id, product_id, nm_id, article, batch_id,
      qty, amount, kind, doc_type, doc_id, created_by
    ) values (
      v_entity_id, null, p_warehouse_id, v_row.product_id, v_row.nm_id, v_row.article, v_batch_id,
      v_row.qty, round(v_line_total, 2), 'receipt', 'purchase_receipt', p_batch_id::text, p_actor
    );

    update public.purchase_receipts
    set warehouse_id = p_warehouse_id,
        stock_batch_id = v_batch_id,
        product_id = v_row.product_id,
        unit_cost = round(v_line_total / v_row.qty, 4),
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

notify pgrst, 'reload schema';
