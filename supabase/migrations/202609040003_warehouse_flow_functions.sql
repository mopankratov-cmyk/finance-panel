-- Движение товаров по ТЗ команды (28.08.2026) — ЧАСТЬ 2 из 2: только процедуры.
--
-- В этом файле НЕТ ни одного `create table` и ни одного `alter table` — это
-- условие его применимости в редакторе Supabase. Схема лежит в 202609040002.
-- Русских литералов внутри функций нет намеренно: они доезжают до базы битыми,
-- подписи живут в lib/warehouse/reasons.ts и lib/warehouse/events.ts.

-- ---------------------------------------------------------------------------
-- 1. Лента событий — только вставка
-- ---------------------------------------------------------------------------
-- Журнал, который можно поправить задним числом, не журнал. Та же дисциплина,
-- что у регистра движений.

create or replace function public.warehouse_events_append_only()
returns trigger
language plpgsql
as $warehouse_events_append_only$
begin
  raise exception 'warehouse_events is append-only';
end;
$warehouse_events_append_only$;

drop trigger if exists warehouse_events_append_only_trigger on public.warehouse_events;
create trigger warehouse_events_append_only_trigger
before update or delete on public.warehouse_events
for each row execute function public.warehouse_events_append_only();

-- ---------------------------------------------------------------------------
-- 2. Коррекция прихода
-- ---------------------------------------------------------------------------
-- ТЗ: при расхождении администратор правит приход, и склад правится вместе с ним.
-- Регистр append-only, поэтому «править» значит записать разницу: приняли не 10,
-- а 12 — в регистр идёт +2 по себестоимости той же партии; брак был 1, стал 3 —
-- списание ещё двух. Непроведённые строки (партия пересчитана, но на остаток не
-- поставлена) правятся прямо в purchase_receipts: проводка возьмёт новые числа.
--
-- Строки со статусом expected здесь не трогаем: у них ещё нет факта, а
-- ожидаемое количество правится напрямую в API. Повторный вызов с теми же
-- целевыми числами даёт нулевые дельты и ничего не пишет — вызов идемпотентен
-- по построению.

create or replace function public.correct_receipt_batch(
  p_batch_id uuid,
  p_lines jsonb,
  p_reason text,
  p_actor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $correct_receipt_batch$
declare
  v_doc_id        uuid := gen_random_uuid();
  v_line          record;
  v_row           public.purchase_receipts%rowtype;
  v_variant       public.product_variants%rowtype;
  v_product       public.products%rowtype;
  v_entity_id     uuid;
  v_new_received  integer;
  v_new_defect    integer;
  v_d_recv        integer;
  v_d_def         integer;
  v_net           integer;
  v_available     integer;
  v_unit_cost     numeric(14, 4);
  v_lines         integer := 0;
  v_posted_lines  integer := 0;
  v_skipped       integer := 0;
  v_delta_qty     integer := 0;
  v_delta_defect  integer := 0;
  v_delta_amount  numeric(14, 2) := 0;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'correction has no lines'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'reason required'; end if;

  for v_line in
    select
      (item->>'id')::bigint as id,
      nullif(item->>'receivedQty', '')::integer as received,
      nullif(item->>'defectQty', '')::integer as defect
    from jsonb_array_elements(p_lines) as item
  loop
    select * into v_row
    from public.purchase_receipts
    where id = v_line.id and batch_id = p_batch_id
    for update;
    if not found then raise exception 'line % is not in batch', v_line.id; end if;
    if v_row.status <> 'received' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_new_received := coalesce(v_line.received, v_row.received_qty, 0);
    v_new_defect := coalesce(v_line.defect, v_row.defect_qty, 0);
    if v_new_received < 0 or v_new_defect < 0 then raise exception 'quantity must be non-negative'; end if;
    if v_new_defect > v_new_received then raise exception 'defect exceeds received'; end if;

    v_d_recv := v_new_received - coalesce(v_row.received_qty, 0);
    v_d_def := v_new_defect - coalesce(v_row.defect_qty, 0);
    if v_d_recv = 0 and v_d_def = 0 then continue; end if;

    if v_row.posted_at is not null then
      if v_row.variant_id is null or v_row.product_id is null or v_row.warehouse_id is null or v_row.stock_batch_id is null then
        raise exception 'posted line % has no variant, warehouse or batch', v_line.id;
      end if;
      select legal_entity_id into v_entity_id from public.stock_batches where id = v_row.stock_batch_id;
      if v_entity_id is null then raise exception 'batch has no legal entity'; end if;

      v_unit_cost := coalesce(v_row.unit_cost, 0);
      -- Принятое прибавляет остаток, брак убавляет: в минус уйти нельзя, как и
      -- в любой другой проводке.
      v_net := v_d_recv - v_d_def;
      if v_net < 0 then
        select coalesce(sum(qty), 0) into v_available
        from public.stock_moves
        where legal_entity_id = v_entity_id
          and warehouse_id = v_row.warehouse_id
          and variant_id = v_row.variant_id;
        if v_available + v_net < 0 then
          select * into v_variant from public.product_variants where id = v_row.variant_id;
          select * into v_product from public.products where id = v_row.product_id;
          raise exception 'not enough stock for % : have %, need %',
            trim(coalesce(v_product.article, '') || ' ' || coalesce(v_variant.size_label, '')), v_available, -v_net;
        end if;
      end if;

      if v_d_recv <> 0 then
        insert into public.stock_moves (
          legal_entity_id, warehouse_id, product_id, variant_id, nm_id, article, batch_id,
          qty, amount, kind, doc_type, doc_id, note, created_by
        ) values (
          v_entity_id, v_row.warehouse_id, v_row.product_id, v_row.variant_id, v_row.nm_id, coalesce(v_row.article, ''),
          v_row.stock_batch_id,
          v_d_recv, round(v_unit_cost * v_d_recv, 2), 'adjustment', 'receipt_correction', v_doc_id::text, p_reason, p_actor
        );
        -- Итог партии — то, что показывает колонка себестоимости приёмки; после
        -- коррекции он обязан сойтись с регистром.
        update public.stock_batches
        set total_qty = greatest(0, total_qty + v_d_recv),
            total_amount = greatest(0, total_amount + round(v_unit_cost * v_d_recv, 2))
        where id = v_row.stock_batch_id;
      end if;

      if v_d_def <> 0 then
        insert into public.stock_moves (
          legal_entity_id, warehouse_id, product_id, variant_id, nm_id, article, batch_id,
          qty, amount, kind, doc_type, doc_id, note, created_by
        ) values (
          v_entity_id, v_row.warehouse_id, v_row.product_id, v_row.variant_id, v_row.nm_id, coalesce(v_row.article, ''),
          v_row.stock_batch_id,
          -v_d_def, -round(v_unit_cost * v_d_def, 2), 'writeoff', 'receipt_correction', v_doc_id::text, 'defect_on_receipt', p_actor
        );
      end if;

      v_posted_lines := v_posted_lines + 1;
      v_delta_amount := v_delta_amount + round(v_unit_cost * v_d_recv, 2) - round(v_unit_cost * v_d_def, 2);
    end if;

    update public.purchase_receipts
    set received_qty = v_new_received,
        defect_qty = v_new_defect,
        updated_at = now()
    where id = v_row.id;

    v_lines := v_lines + 1;
    v_delta_qty := v_delta_qty + v_d_recv;
    v_delta_defect := v_delta_defect + v_d_def;
  end loop;

  return jsonb_build_object(
    'correctionId', case when v_posted_lines > 0 then v_doc_id::text else null end,
    'lines', v_lines,
    'postedLines', v_posted_lines,
    'deltaQty', v_delta_qty,
    'deltaDefect', v_delta_defect,
    'deltaAmount', v_delta_amount,
    'skipped', v_skipped
  );
end;
$correct_receipt_batch$;

revoke all on function public.correct_receipt_batch(uuid, jsonb, text, text) from public;
grant execute on function public.correct_receipt_batch(uuid, jsonb, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Подтверждение задания на отгрузку
-- ---------------------------------------------------------------------------
-- Задание — документ-черновик со строками. Фулфилмент нажал «Отгружено» —
-- проводим обычную отгрузку теми же строками и переводим тот же документ в
-- posted: номер, под которым задание висело в списке, остаётся номером накладной.
-- Всё в одной транзакции: либо товар списан и документ закрыт, либо ничего.
--
-- p_lines позволяет подтвердить не всё: [{variantId, qty}] переопределяет
-- количество по существующим строкам (0 — не отгружать). Новых позиций через
-- подтверждение добавить нельзя — это правка задания, а не его выполнение.

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

-- ---------------------------------------------------------------------------
-- 4. Списание с датой
-- ---------------------------------------------------------------------------
-- ТЗ: форма брака содержит дату — брак, найденный в апреле, вносят в мае, и
-- в журнале он должен стоять апрелем. Тело функции — как в 202608230015, плюс
-- один аргумент. Старую сигнатуру снимаем: иначе вызов с пятью аргументами
-- стал бы неоднозначным между ней и новой с умолчанием.

drop function if exists public.post_writeoff(uuid, uuid, jsonb, text, text);

create or replace function public.post_writeoff(
  p_legal_entity_id uuid,
  p_warehouse_id uuid,
  p_lines jsonb,
  p_reason text,
  p_actor text default null,
  p_occurred_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $post_writeoff$
declare
  v_warehouse    public.warehouses%rowtype;
  v_doc_id       uuid;
  v_line         record;
  v_available    integer;
  v_unit_cost    numeric(14, 2);
  v_moves        integer := 0;
  v_qty_total    integer := 0;
  v_amount_total numeric(14, 2) := 0;
  v_variant      public.product_variants%rowtype;
  v_product      public.products%rowtype;
  v_at           timestamptz := coalesce(p_occurred_at, now());
begin
  select * into v_warehouse from public.warehouses where id = p_warehouse_id;
  if not found then raise exception 'warehouse not found'; end if;
  if not v_warehouse.is_active then raise exception 'warehouse is archived'; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'writeoff has no lines'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'reason required'; end if;
  if v_at > now() + interval '1 day' then raise exception 'date in the future'; end if;

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
      qty, amount, kind, doc_type, doc_id, occurred_at, note, created_by
    ) values (
      p_legal_entity_id, null, p_warehouse_id, v_variant.product_id, v_line.variant_id,
      v_product.nm_id, v_product.article,
      -v_line.qty, -round(v_unit_cost * v_line.qty, 2), 'writeoff', 'writeoff', v_doc_id::text, v_at, p_reason, p_actor
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

revoke all on function public.post_writeoff(uuid, uuid, jsonb, text, text, timestamptz) from public;
grant execute on function public.post_writeoff(uuid, uuid, jsonb, text, text, timestamptz) to service_role;

notify pgrst, 'reload schema';
