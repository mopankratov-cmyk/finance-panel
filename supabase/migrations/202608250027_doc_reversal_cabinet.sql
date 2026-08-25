-- Сторно одной накладной, а не всей проводки.
--
-- Отгрузка со склада проводится одной операцией, но едет в разные места: на склад
-- Wildberries своя машина, на Ozon своя. Бумага у каждой поездки должна быть своя,
-- поэтому одна проводка теперь порождает по документу на кабинет.
--
-- Сторно жило допущением «один документ — одна проводка»: оно отменяло ВСЕ движения
-- с общим doc_id. С раздельными накладными это значило бы, что отмена поездки на
-- Ozon тихо вернёт на склад и то, что уже уехало на Wildberries.
--
-- Поэтому функция получает кабинет и отменяет только его строки. Без кабинета
-- (перемещение, списание, старые общие отгрузки) поведение прежнее — все строки.
--
-- Аргумент со значением по умолчанию нельзя добавить через create or replace:
-- получится перегрузка, и вызов с четырьмя аргументами станет неоднозначным.
-- Поэтому старую сигнатуру сначала убираем.

drop function if exists public.post_doc_reversal(text, text, text, text);

create or replace function public.post_doc_reversal(
  p_source_movement_doc_id text,
  p_new_movement_doc_id text,
  p_source_number text,
  p_actor text default null,
  p_cabinet_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $post_doc_reversal$
declare
  v_line      record;
  v_moves     integer := 0;
  v_qty       integer := 0;
  v_amount    numeric(14, 2) := 0;
begin
  if p_source_movement_doc_id is null or p_source_movement_doc_id = '' then
    raise exception 'source document has no movements';
  end if;
  -- Сторожок по номеру исходного документа: у раздельных накладных номера разные,
  -- поэтому отмена одной не запирает соседнюю.
  if exists (select 1 from public.stock_moves where doc_type = 'reversal' and note = p_source_number) then
    raise exception 'document already reversed';
  end if;

  for v_line in
    select legal_entity_id, cabinet_id, warehouse_id, product_id, variant_id, nm_id, article, qty, amount, kind
    from public.stock_moves
    where doc_id = p_source_movement_doc_id
      and (p_cabinet_id is null or cabinet_id = p_cabinet_id)
    order by id
  loop
    insert into public.stock_moves (
      legal_entity_id, cabinet_id, warehouse_id, product_id, variant_id, nm_id, article,
      qty, amount, kind, doc_type, doc_id, note, created_by
    ) values (
      v_line.legal_entity_id, v_line.cabinet_id, v_line.warehouse_id, v_line.product_id, v_line.variant_id,
      v_line.nm_id, v_line.article,
      -v_line.qty, -v_line.amount, v_line.kind, 'reversal', p_new_movement_doc_id, p_source_number, p_actor
    );
    v_moves := v_moves + 1;
    v_qty := v_qty + abs(v_line.qty);
    v_amount := v_amount + abs(v_line.amount);
  end loop;

  if v_moves = 0 then raise exception 'source document has no movements'; end if;

  return jsonb_build_object('lines', v_moves, 'qty', v_qty, 'amount', v_amount);
end;
$post_doc_reversal$;

revoke all on function public.post_doc_reversal(text, text, text, text, uuid) from public;
grant execute on function public.post_doc_reversal(text, text, text, text, uuid) to service_role;

notify pgrst, 'reload schema';
