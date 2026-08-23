-- Перемещение между складами и возврат с маркетплейса.
--
-- Перемещение: Уссурийск → Москва идёт неделю, и всё это время товар не должен
-- исчезать из остатков. Транзит моделируется обычным складом «В пути»: отправка
-- перекладывает туда, приход — оттуда на целевой склад. Никакой новой механики,
-- только два движения и склад особого вида.
--
-- Возврат с маркетплейса: то, что приехало с ПВЗ обратно на фулфилмент. Годное
-- возвращается в остаток, брак сразу списывается — иначе он попал бы в отгрузку
-- как товарный.

alter table public.warehouses
  drop constraint if exists warehouses_kind_check;
alter table public.warehouses
  add constraint warehouses_kind_check check (kind in ('own', 'fulfillment', 'transit'));

-- Движения получают собственные виды: перемещение и возврат нельзя путать
-- с приёмкой и отгрузкой — у них другой смысл в отчётах.
alter table public.stock_moves
  drop constraint if exists stock_moves_kind_check;
alter table public.stock_moves
  add constraint stock_moves_kind_check
  check (kind in ('receipt', 'shipment', 'writeoff', 'return', 'adjustment', 'transfer'));

-- ---------------------------------------------------------------------------
-- Перемещение
-- ---------------------------------------------------------------------------
-- Одним документом: списание с источника и приход на приёмник по себестоимости
-- источника. Деньги не меняются — товар просто оказался в другом месте.

create or replace function public.post_transfer(
  p_legal_entity_id uuid,
  p_from_warehouse uuid,
  p_to_warehouse uuid,
  p_lines jsonb,
  p_note text default null,
  p_actor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $post_transfer$
declare
  v_from        public.warehouses%rowtype;
  v_to          public.warehouses%rowtype;
  v_doc_id      uuid;
  v_line        record;
  v_available   integer;
  v_unit_cost   numeric(14, 2);
  v_moves       integer := 0;
  v_qty_total   integer := 0;
  v_variant     public.product_variants%rowtype;
  v_product     public.products%rowtype;
begin
  if p_from_warehouse = p_to_warehouse then raise exception 'same warehouse'; end if;
  select * into v_from from public.warehouses where id = p_from_warehouse;
  if not found then raise exception 'source warehouse not found'; end if;
  select * into v_to from public.warehouses where id = p_to_warehouse;
  if not found then raise exception 'target warehouse not found'; end if;
  if not v_to.is_active then raise exception 'target warehouse is archived'; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'transfer has no lines'; end if;

  for v_line in
    select (item->>'variantId')::uuid as variant_id, sum((item->>'qty')::integer) as qty
    from jsonb_array_elements(p_lines) as item
    group by (item->>'variantId')::uuid
  loop
    if v_line.qty is null or v_line.qty <= 0 then raise exception 'quantity must be positive'; end if;
    select coalesce(sum(qty), 0) into v_available
    from public.stock_moves
    where legal_entity_id = p_legal_entity_id and warehouse_id = p_from_warehouse and variant_id = v_line.variant_id;
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
    where legal_entity_id = p_legal_entity_id and warehouse_id = p_from_warehouse and variant_id = v_line.variant_id;

    insert into public.stock_moves (
      legal_entity_id, warehouse_id, product_id, variant_id, nm_id, article,
      qty, amount, kind, doc_type, doc_id, note, created_by
    ) values (
      p_legal_entity_id, p_from_warehouse, v_variant.product_id, v_line.variant_id, v_product.nm_id, v_product.article,
      -v_line.qty, -round(v_unit_cost * v_line.qty, 2), 'transfer', 'transfer', v_doc_id::text, p_note, p_actor
    );

    insert into public.stock_moves (
      legal_entity_id, warehouse_id, product_id, variant_id, nm_id, article,
      qty, amount, kind, doc_type, doc_id, note, created_by
    ) values (
      p_legal_entity_id, p_to_warehouse, v_variant.product_id, v_line.variant_id, v_product.nm_id, v_product.article,
      v_line.qty, round(v_unit_cost * v_line.qty, 2), 'transfer', 'transfer', v_doc_id::text, p_note, p_actor
    );

    v_moves := v_moves + 1;
    v_qty_total := v_qty_total + v_line.qty;
  end loop;

  return jsonb_build_object(
    'transferId', v_doc_id,
    'lines', v_moves,
    'qty', v_qty_total
  );
end;
$post_transfer$;

revoke all on function public.post_transfer(uuid, uuid, uuid, jsonb, text, text) from public;
grant execute on function public.post_transfer(uuid, uuid, uuid, jsonb, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Возврат с маркетплейса
-- ---------------------------------------------------------------------------
-- Товар приехал обратно на склад. Себестоимость берётся текущая складская, а если
-- позиции на складе не осталось — из карточки товара: возврат не должен приходовать
-- по нулю только потому, что всё было распродано.

create or replace function public.post_return(
  p_legal_entity_id uuid,
  p_warehouse_id uuid,
  p_cabinet_id uuid,
  p_lines jsonb,
  p_note text default null,
  p_actor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $post_return$
declare
  v_warehouse   public.warehouses%rowtype;
  v_doc_id      uuid;
  v_line        record;
  v_unit_cost   numeric(14, 2);
  v_moves       integer := 0;
  v_qty_total   integer := 0;
  v_defects     integer := 0;
  v_variant     public.product_variants%rowtype;
  v_product     public.products%rowtype;
begin
  select * into v_warehouse from public.warehouses where id = p_warehouse_id;
  if not found then raise exception 'warehouse not found'; end if;
  if not v_warehouse.is_active then raise exception 'warehouse is archived'; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'return has no lines'; end if;

  v_doc_id := gen_random_uuid();

  for v_line in
    select
      (item->>'variantId')::uuid as variant_id,
      (item->>'qty')::integer as qty,
      coalesce((item->>'defectQty')::integer, 0) as defect
    from jsonb_array_elements(p_lines) as item
  loop
    if v_line.qty is null or v_line.qty <= 0 then raise exception 'quantity must be positive'; end if;
    if v_line.defect > v_line.qty then raise exception 'defect exceeds returned'; end if;

    select * into v_variant from public.product_variants where id = v_line.variant_id;
    if not found then raise exception 'variant not found'; end if;
    select * into v_product from public.products where id = v_variant.product_id;

    select
      case when coalesce(sum(qty), 0) > 0 then round(coalesce(sum(amount), 0) / sum(qty), 2) else 0 end
      into v_unit_cost
    from public.stock_moves
    where legal_entity_id = p_legal_entity_id and warehouse_id = p_warehouse_id and variant_id = v_line.variant_id;

    -- Позиции на складе нет — берём цену из карточки, но только рублёвую: курса
    -- на этом уровне нет, а врать про валюту хуже, чем оставить ноль.
    if v_unit_cost = 0 and v_product.factory_price is not null and coalesce(v_product.factory_currency, 'RUB') = 'RUB' then
      v_unit_cost := v_product.factory_price;
    end if;

    insert into public.stock_moves (
      legal_entity_id, cabinet_id, warehouse_id, product_id, variant_id, nm_id, article,
      qty, amount, kind, doc_type, doc_id, note, created_by
    ) values (
      p_legal_entity_id, p_cabinet_id, p_warehouse_id, v_variant.product_id, v_line.variant_id,
      v_product.nm_id, v_product.article,
      v_line.qty, round(v_unit_cost * v_line.qty, 2), 'return', 'return', v_doc_id::text, p_note, p_actor
    );

    -- Возвращённый брак не должен попасть в отгрузку как товарный: списываем сразу.
    if v_line.defect > 0 then
      insert into public.stock_moves (
        legal_entity_id, cabinet_id, warehouse_id, product_id, variant_id, nm_id, article,
        qty, amount, kind, doc_type, doc_id, note, created_by
      ) values (
        p_legal_entity_id, p_cabinet_id, p_warehouse_id, v_variant.product_id, v_line.variant_id,
        v_product.nm_id, v_product.article,
        -v_line.defect, -round(v_unit_cost * v_line.defect, 2), 'writeoff', 'return', v_doc_id::text,
        'defect_on_return', p_actor
      );
      v_defects := v_defects + v_line.defect;
    end if;

    v_moves := v_moves + 1;
    v_qty_total := v_qty_total + v_line.qty;
  end loop;

  return jsonb_build_object(
    'returnId', v_doc_id,
    'lines', v_moves,
    'qty', v_qty_total,
    'defects', v_defects
  );
end;
$post_return$;

revoke all on function public.post_return(uuid, uuid, uuid, jsonb, text, text) from public;
grant execute on function public.post_return(uuid, uuid, uuid, jsonb, text, text) to service_role;

notify pgrst, 'reload schema';
