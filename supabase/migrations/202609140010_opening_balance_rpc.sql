-- Начальные остатки: один ручной ввод, а не приёмка без заказа и партии.
-- Тот же паттерн, что post_writeoff (202609040003_warehouse_flow_functions.sql) —
-- отличие только в том, что себестоимость строки не считается по истории
-- (истории и не должно быть — см. проверку ниже), а вводится человеком.
--
-- batch_id у stock_moves намеренно не заполняем — stock_batches.receipt_batch_id
-- обязателен и уникален, и у начального остатка нет своей партии приёмки.
-- Пропуск batch_id — уже устоявшийся приём в этом же контуре (post_writeoff
-- его тоже не пишет).

drop function if exists public.post_opening_balance(uuid, uuid, jsonb, text, text, timestamptz);

create or replace function public.post_opening_balance(
  p_legal_entity_id uuid,
  p_warehouse_id uuid,
  p_lines jsonb,
  p_note text,
  p_actor text default null,
  p_occurred_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $post_opening_balance$
declare
  v_warehouse    public.warehouses%rowtype;
  v_doc_id       uuid;
  v_line         record;
  v_variant      public.product_variants%rowtype;
  v_product      public.products%rowtype;
  v_moves        integer := 0;
  v_qty_total    integer := 0;
  v_amount_total numeric(14, 2) := 0;
  v_at           timestamptz := coalesce(p_occurred_at, now());
begin
  -- Транзакционная блокировка на юрлицо — тот же приём, что уже есть в этом же
  -- дне миграций (202609140002/0003, hashtextextended). Без неё «пусто ли
  -- у юрлица» и вставка ниже — раздельные шаги: два одновременных запроса
  -- оба увидели бы пустую историю и оба бы её завели, а append-only регистр
  -- такую дублированную запись назад уже не даст. Лочим саму проверку и всю
  -- вставку одной транзакцией — снимается автоматически на commit/rollback.
  perform pg_advisory_xact_lock(hashtextextended(p_legal_entity_id::text, 0));

  select * into v_warehouse from public.warehouses where id = p_warehouse_id;
  if not found then raise exception 'warehouse not found'; end if;
  if not v_warehouse.is_active then raise exception 'warehouse is archived'; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'opening balance has no lines'; end if;
  if v_at > now() + interval '1 day' then raise exception 'date in the future'; end if;

  -- Ядро задачи: у юрлица должна быть пустая история движений. Если уже есть
  -- хоть одна проводка — это не «завести с нуля», а искажение остатка задним
  -- числом; для этого в модуле уже есть коррекция и обычная приёмка.
  if exists (select 1 from public.stock_moves where legal_entity_id = p_legal_entity_id) then
    raise exception 'legal entity already has stock history';
  end if;

  v_doc_id := gen_random_uuid();

  for v_line in
    select
      (item->>'variantId')::uuid as variant_id,
      (item->>'qty')::integer as qty,
      (item->>'unitCost')::numeric as unit_cost
    from jsonb_array_elements(p_lines) as item
  loop
    if v_line.qty is null or v_line.qty <= 0 then raise exception 'quantity must be positive'; end if;
    if v_line.unit_cost is null or v_line.unit_cost < 0 then raise exception 'unit cost must not be negative'; end if;

    select * into v_variant from public.product_variants where id = v_line.variant_id;
    if not found then raise exception 'variant not found'; end if;
    select * into v_product from public.products where id = v_variant.product_id;

    -- Роут отсеивает размер не по ЭТОМУ юрлицу, а по всем, к которым у
    -- вызывающего вообще есть доступ (тот же паттерн, что transfers/writeoff) —
    -- там чужой размер ловит нехватка остатка, а здесь остатка ещё нет вовсе,
    -- проверять нечего. Сверяем владельца прямо тут, а не полагаемся на роут.
    if v_product.legal_entity_id is distinct from p_legal_entity_id then
      raise exception 'variant belongs to a different legal entity';
    end if;

    insert into public.stock_moves (
      legal_entity_id, cabinet_id, warehouse_id, product_id, variant_id, nm_id, article,
      qty, amount, kind, doc_type, doc_id, occurred_at, note, created_by
    ) values (
      p_legal_entity_id, null, p_warehouse_id, v_variant.product_id, v_line.variant_id,
      v_product.nm_id, v_product.article,
      v_line.qty, round(v_line.unit_cost * v_line.qty, 2), 'receipt', 'opening_balance', v_doc_id::text, v_at, p_note, p_actor
    );

    v_moves := v_moves + 1;
    v_qty_total := v_qty_total + v_line.qty;
    v_amount_total := v_amount_total + round(v_line.unit_cost * v_line.qty, 2);
  end loop;

  return jsonb_build_object(
    'openingId', v_doc_id,
    'lines', v_moves,
    'qty', v_qty_total,
    'amount', v_amount_total
  );
end;
$post_opening_balance$;

revoke all on function public.post_opening_balance(uuid, uuid, jsonb, text, text, timestamptz) from public;
grant execute on function public.post_opening_balance(uuid, uuid, jsonb, text, text, timestamptz) to service_role;

notify pgrst, 'reload schema';
