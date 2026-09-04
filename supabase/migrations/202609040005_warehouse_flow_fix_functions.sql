-- Правки по итогам ревью движения товаров — ЧАСТЬ 2 из 2: только процедуры.
--
-- В этом файле НЕТ ни одного create table и ни одного alter table.
--
-- Задание — это план, а не пожелание. Подтверждая отгрузку, фулфилмент может
-- отгрузить МЕНЬШЕ (не нашли, отложили), но не больше: «отгрузить 999 по
-- заданию на 10» — это не выполнение задания, а новая отгрузка, и делать её
-- надо отдельным документом. Раньше переопределение количества принималось
-- как есть, и лишнее списывалось со склада под номером чужого задания.

create or replace function public.post_shipment_task(
  p_doc_id uuid,
  p_actor text default null,
  p_lines jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $post_shipment_task$
declare
  v_doc         public.stock_docs%rowtype;
  v_line        record;
  v_override    integer;
  v_qty         integer;
  v_lines       jsonb := '[]'::jsonb;
  v_result      jsonb;
  v_shipment_id text;
begin
  select * into v_doc from public.stock_docs where id = p_doc_id for update;
  if not found then raise exception 'task not found'; end if;
  if v_doc.kind <> 'shipment' then raise exception 'not a shipment task'; end if;
  if v_doc.status <> 'draft' then raise exception 'task is not a draft'; end if;
  if v_doc.warehouse_id is null then raise exception 'task has no warehouse'; end if;
  if v_doc.cabinet_id is null then raise exception 'task has no cabinet'; end if;

  for v_line in
    select id, variant_id, qty
    from public.stock_doc_lines
    where doc_id = p_doc_id
    order by id
  loop
    v_qty := v_line.qty;
    if p_lines is not null then
      -- Нет переопределения — v_override становится null, и берётся плановое.
      select nullif(item->>'qty', '')::integer into v_override
      from jsonb_array_elements(p_lines) as item
      where (item->>'variantId')::uuid = v_line.variant_id
      limit 1;
      if v_override is not null then v_qty := v_override; end if;
    end if;
    if v_qty < 0 then raise exception 'quantity must be non-negative'; end if;
    -- Больше задания не отгружаем: план — потолок.
    if v_qty > v_line.qty then raise exception 'over plan'; end if;

    update public.stock_doc_lines set shipped_qty = v_qty where id = v_line.id;
    if v_qty > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'variantId', v_line.variant_id,
        'cabinetId', v_doc.cabinet_id,
        'qty', v_qty
      ));
    end if;
  end loop;

  if jsonb_array_length(v_lines) = 0 then raise exception 'nothing to ship'; end if;

  v_result := public.post_shipment(v_doc.legal_entity_id, v_doc.warehouse_id, v_lines, v_doc.note, p_actor);
  v_shipment_id := v_result->>'shipmentId';

  update public.stock_docs
  set status = 'posted',
      movement_doc_id = v_shipment_id,
      result = v_result || jsonb_build_object('cabinetId', v_doc.cabinet_id),
      confirmed_at = now(),
      confirmed_by = p_actor,
      occurred_at = now(),
      updated_at = now()
  where id = p_doc_id;

  return v_result || jsonb_build_object('docId', p_doc_id, 'number', v_doc.number);
end;
$post_shipment_task$;

revoke all on function public.post_shipment_task(uuid, text, jsonb) from public;
grant execute on function public.post_shipment_task(uuid, text, jsonb) to service_role;

notify pgrst, 'reload schema';
